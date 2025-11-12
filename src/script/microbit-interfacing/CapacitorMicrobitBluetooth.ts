/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */

import StaticConfiguration from '../../StaticConfiguration';
import { outputting } from '../stores/uiStore';
import { logError, logEvent, logMessage } from '../utils/logging';
import MBSpecs from './MBSpecs';
import MicrobitConnection, { DeviceRequestStates } from './MicrobitConnection';
import { UARTMessageType } from './Microbits';
import {
  onAccelerometerChange,
  onButtonChange,
  onUARTDataReceived,
} from './change-listeners';
import {
  stateOnAssigned,
  stateOnConnected,
  stateOnDisconnected,
  stateOnReady,
  stateOnReconnectionAttempt,
} from './state-updaters';

// Type definitions for Capacitor Bluetooth LE plugin
// These will be available once @capacitor-community/bluetooth-le is installed
interface BleDevice {
  deviceId: string;
  name?: string;
  rssi?: number;
}

interface BleService {
  uuid: string;
  deviceId: string;
  characteristics?: BleCharacteristic[];
}

interface BleCharacteristic {
  uuid: string;
  service: string;
  deviceId: string;
  properties?: {
    read?: boolean;
    write?: boolean;
    writeWithoutResponse?: boolean;
    notify?: boolean;
    indicate?: boolean;
  };
}

interface BleDescriptor {
  uuid: string;
  characteristic: string;
  service: string;
  deviceId: string;
}

// Global flag to track if Bluetooth has been initialized
let bluetoothInitialized = false;
let bluetoothInitializationPromise: Promise<void> | null = null;

// Helper to get the Capacitor Bluetooth plugin
function getBluetoothPlugin(): any {
  const Capacitor = (window as any).Capacitor;
  if (!Capacitor) {
    throw new Error('Capacitor is not available');
  }
  
  // Try to get the Bluetooth LE plugin
  // This will work once @capacitor-community/bluetooth-le is installed
  try {
    return Capacitor.Plugins.BluetoothLe || 
           (window as any).BluetoothLe ||
           require('@capacitor-community/bluetooth-le').BluetoothLe;
  } catch (e) {
    throw new Error('Bluetooth LE plugin not available. Please install @capacitor-community/bluetooth-le');
  }
}

/**
 * Initialize Bluetooth LE plugin once globally
 * This should be called once when the app starts, not before each connection
 */
export async function initializeBluetoothLEOnce(): Promise<void> {
  // If already initialized, return immediately
  if (bluetoothInitialized) {
    return;
  }

  // If initialization is in progress, wait for it
  if (bluetoothInitializationPromise) {
    return bluetoothInitializationPromise;
  }

  // Start initialization
  bluetoothInitializationPromise = (async () => {
    try {
      const bluetoothPlugin = getBluetoothPlugin();
      logMessage('Initializing Bluetooth LE plugin globally (one-time initialization)...');
      await bluetoothPlugin.initialize();
      bluetoothInitialized = true;
      logMessage('Bluetooth LE plugin initialized successfully');
    } catch (e: any) {
      // If already initialized, that's fine
      if (e.message && e.message.includes('already initialized')) {
        logMessage('Bluetooth LE plugin already initialized');
        bluetoothInitialized = true;
      } else {
        logError('Failed to initialize Bluetooth LE plugin', e);
        bluetoothInitializationPromise = null; // Allow retry
        throw e;
      }
    }
  })();

  return bluetoothInitializationPromise;
}

type OutputCharacteristics = {
  io: BleCharacteristic;
  matrix: BleCharacteristic;
  uart: BleCharacteristic;
};

/**
 * Capacitor-based Bluetooth implementation for iOS devices
 */
export class CapacitorMicrobitBluetooth implements MicrobitConnection {
  inUseAs: Set<DeviceRequestStates> = new Set();

  private outputCharacteristics: OutputCharacteristics | undefined;
  private deviceId: string | undefined;
  private bluetoothPlugin: any;
  private duringExplicitConnectDisconnect: number = 0;
  private connecting = false;
  private isReconnect = false;
  private reconnectReadyPromise: Promise<void> | undefined;
  private finalAttempt = false;
  private isConnected = false;
  private notificationListeners: Map<string, any> = new Map(); // Store listeners for cleanup

  private outputWriteQueue: {
    busy: boolean;
    queue: Array<(outputCharacteristics: OutputCharacteristics) => Promise<void>>;
  } = {
    busy: false,
    queue: [],
  };

  constructor(
    public readonly name: string,
    public readonly device: BleDevice,
  ) {
    this.deviceId = device.deviceId;
    try {
      this.bluetoothPlugin = getBluetoothPlugin();
    } catch (e) {
      logError('Failed to get Bluetooth plugin', e);
      throw e;
    }
  }

  /**
   * Ensure Bluetooth is initialized (but don't initialize again if already done)
   */
  private async ensureInitialized(): Promise<void> {
    // Use the global initialization function
    await initializeBluetoothLEOnce();
    
    // Check authorization status if available
    try {
      if (this.bluetoothPlugin.getAuthorizationStatus) {
        const authStatus = await this.bluetoothPlugin.getAuthorizationStatus();
        logMessage('Bluetooth authorization status:', authStatus);
        if (authStatus && authStatus !== 'granted' && authStatus !== 'allowed') {
          logMessage('Warning: Bluetooth authorization may not be granted:', authStatus);
        }
      }
    } catch (authError) {
      logMessage('Could not check authorization status (may not be supported):', authError);
    }
  }

  async connect(...states: DeviceRequestStates[]): Promise<void> {
    logEvent({
      type: this.isReconnect ? 'Reconnect' : 'Connect',
      action: 'Bluetooth connect start (Capacitor)',
      states,
    });

    if (this.duringExplicitConnectDisconnect) {
      logMessage('Skipping connect attempt when one is already in progress');
      return;
    }

    this.duringExplicitConnectDisconnect++;
    this.connecting = true;

    try {
      if (!this.deviceId) {
        throw new Error('Device ID is not available');
      }

      // Ensure Bluetooth LE is initialized
      await this.ensureInitialized();

      // Verify Bluetooth is enabled
      try {
        if (this.bluetoothPlugin.isEnabled) {
          const isEnabled = await this.bluetoothPlugin.isEnabled();
          logMessage('Bluetooth enabled status:', isEnabled);
          if (!isEnabled) {
            throw new Error('Bluetooth is not enabled on the device. Please enable Bluetooth in iOS Settings.');
          }
        }
      } catch (enableError) {
        logMessage('Could not check Bluetooth enabled status:', enableError);
      }

      // Verify plugin is working by checking available methods
      logMessage('Bluetooth plugin methods available:', {
        hasConnect: typeof this.bluetoothPlugin.connect === 'function',
        hasIsConnected: typeof this.bluetoothPlugin.isConnected === 'function',
        hasDisconnect: typeof this.bluetoothPlugin.disconnect === 'function',
        pluginKeys: Object.keys(this.bluetoothPlugin || {})
      });

      // Check if device is already connected using getConnectedDevices
      let isAlreadyConnected = false;
      try {
        if (this.bluetoothPlugin.getConnectedDevices) {
          const connectedDevices = await this.bluetoothPlugin.getConnectedDevices({
            services: [] // Empty array to get all connected devices
          });
          logMessage('Currently connected devices:', connectedDevices);
          if (connectedDevices && Array.isArray(connectedDevices)) {
            isAlreadyConnected = connectedDevices.some((device: any) => 
              (device.deviceId || device.id) === this.deviceId
            );
            logMessage('Device connection status check:', { isAlreadyConnected, deviceId: this.deviceId });
          }
        }
      } catch (checkError) {
        logMessage('Could not check connected devices (may not be supported):', checkError);
      }

      // Connect to the device
      logMessage('Connecting to device via Capacitor Bluetooth', {
        deviceId: this.deviceId,
        timeout: StaticConfiguration.connectTimeoutDuration,
        isAlreadyConnected
      });

      if (!isAlreadyConnected) {
        // Retry connection up to 2 times with delays
        const maxRetries = 2;
        let lastError: any = null;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (attempt > 0) {
            // Before retrying, ensure any previous connection attempt is fully cleaned up
            logMessage('Cleaning up previous connection attempt...');
            try {
              // Try to disconnect if there's a lingering connection
              await this.bluetoothPlugin.disconnect({ deviceId: this.deviceId });
              logMessage('Disconnected previous attempt');
            } catch (disconnectError) {
              logMessage('No previous connection to disconnect (this is OK):', disconnectError);
            }
            
            // Wait longer between retries to let the peripheral fully reset
            // The micro:bit needs time to return to pairing mode
            const delay = 2000 + (1000 * attempt); // 2s, 3s delays
            logMessage(`Waiting ${delay}ms before retry (attempt ${attempt + 1}/${maxRetries + 1})...`);
            logMessage('Please ensure the micro:bit is still in pairing mode (LED pattern visible)');
            await new Promise(resolve => setTimeout(resolve, delay));
          }

          try {
            // Use a longer timeout for iOS - micro:bit pairing can take time
            // iOS Core Bluetooth sometimes needs more time to complete the connection
            const connectionTimeout = StaticConfiguration.connectTimeoutDuration * 1.5; // 15 seconds
            
            const connectOptions: any = {
              deviceId: this.deviceId,
              timeout: connectionTimeout
            };

            logMessage(`Connection attempt ${attempt + 1}/${maxRetries + 1} with options:`, connectOptions);
            logMessage('Starting connection - micro:bit should show smiley face if connection is being attempted');

            // iOS requires explicit service UUIDs in connect() - otherwise it times out
            // Add the micro:bit service UUIDs to help iOS discover services
            const connectOptionsWithServices: any = {
              deviceId: this.deviceId,
              timeout: connectionTimeout,
              services: [
                MBSpecs.Services.UART_SERVICE,
                MBSpecs.Services.ACCEL_SERVICE,
                MBSpecs.Services.DEVICE_INFO_SERVICE,
                MBSpecs.Services.LED_SERVICE,
                MBSpecs.Services.IO_SERVICE,
                MBSpecs.Services.BUTTON_SERVICE,
              ]
            };

            logMessage('Connecting with service UUIDs specified for iOS compatibility');

            await this.bluetoothPlugin.connect(connectOptionsWithServices);
            logMessage('Connect() call completed successfully');
            
            // Wait for the connection to stabilize on iOS
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // If connect() resolved successfully, trust it - the connection is established
            // getConnectedDevices() may not immediately reflect the connection due to timing
            // The native logs show "Connection successful" which is the authoritative source
            logMessage('Connection established successfully - proceeding with service discovery');
            break; // Success, exit retry loop
            
          } catch (connectError: any) {
            lastError = connectError;
            logError(`Connection attempt ${attempt + 1} failed`, connectError);
            logError('Connection error details:', {
              message: connectError?.message,
              errorMessage: connectError?.errorMessage,
              code: connectError?.code,
              error: String(connectError),
              keys: connectError ? Object.keys(connectError) : []
            });
            
            // If this is the last attempt, throw the error
            if (attempt === maxRetries) {
              const errorMessage = connectError?.message || connectError?.errorMessage || String(connectError);
              if (errorMessage.includes('timeout') || errorMessage.includes('Connection timeout')) {
                throw new Error('Connection timeout after multiple attempts. The micro:bit is responding (showing smiley/sad faces) but iOS cannot complete the connection. This may be a firmware or compatibility issue. Try:\n1. Flashing the micro:bit with the latest firmware\n2. Ensuring the micro:bit stays in pairing mode throughout all connection attempts\n3. Restarting the iPad Bluetooth (Settings > Bluetooth > toggle off/on)\n4. Trying a different micro:bit if available');
              }
              throw connectError;
            }
            // Otherwise, continue to next retry
          }
        }
        
        if (lastError && !this.isConnected) {
          throw lastError;
        }
      } else {
        logMessage('Device appears to already be connected, skipping connect call');
      }

      this.isConnected = true;
      logMessage('Device connected via Capacitor Bluetooth');

      // On iOS, services need to be discovered after connection
      // The plugin may do this automatically, but we should wait a bit for services to be available
      logMessage('Waiting for services to be discovered...');
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to allow service discovery

      // Discover services explicitly if the plugin supports it
      try {
        const servicesToDiscover = [
          MBSpecs.Services.DEVICE_INFO_SERVICE,
          MBSpecs.Services.ACCEL_SERVICE,
          MBSpecs.Services.BUTTON_SERVICE,
          MBSpecs.Services.UART_SERVICE,
          MBSpecs.Services.LED_SERVICE,
          MBSpecs.Services.IO_SERVICE,
        ];
        
        // Try to discover services if the method exists
        if (this.bluetoothPlugin.discoverServices) {
          logMessage('Discovering services...');
          await this.bluetoothPlugin.discoverServices({
            deviceId: this.deviceId,
            services: servicesToDiscover,
          });
          logMessage('Services discovered successfully');
        } else {
          logMessage('Plugin does not support explicit service discovery, relying on automatic discovery');
        }
      } catch (discoverError: any) {
        // Service discovery might not be necessary or might fail - log but continue
        logMessage('Service discovery note:', discoverError?.message || 'Unknown error');
        // Continue anyway - the plugin might handle service discovery automatically
      }

      // Wait a bit more for the connection to be fully established
      // iOS sometimes needs a moment after connect() returns
      await new Promise(resolve => setTimeout(resolve, 300));

      // Get model number
      let microbitVersion: MBSpecs.MBVersion;
      try {
        microbitVersion = await this.getModelNumber();
      } catch (modelError: any) {
        logError('Failed to read model number, retrying...', modelError);
        // Retry once after a short delay
        await new Promise(resolve => setTimeout(resolve, 500));
        microbitVersion = await this.getModelNumber();
      }

      states.forEach(stateOnConnected);
      
      logMessage('Setting up services for states:', states);
      if (states.includes(DeviceRequestStates.INPUT)) {
        logMessage('Setting up INPUT services (accelerometer, buttons, UART)...');
        await this.listenToInputServices();
        logMessage('INPUT services setup complete');
      }
      if (states.includes(DeviceRequestStates.OUTPUT)) {
        logMessage('Setting up OUTPUT services...');
        await this.listenToOutputServices();
        logMessage('OUTPUT services setup complete');
      }
      
      states.forEach(s => this.inUseAs.add(s));
      states.forEach(s => stateOnAssigned(s, microbitVersion));
      states.forEach(s => stateOnReady(s));
      
      logEvent({
        type: this.isReconnect ? 'Reconnect' : 'Connect',
        action: 'Bluetooth connect success (Capacitor)',
        states,
      });
    } catch (e) {
      logError('Bluetooth connect error (Capacitor)', e);
      logEvent({
        type: this.isReconnect ? 'Reconnect' : 'Connect',
        action: 'Bluetooth connect failed (Capacitor)',
        states,
      });
      await this.disconnectInternal(false);
      throw new Error('Failed to establish a connection!');
    } finally {
      this.connecting = false;
      this.finalAttempt = false;
      this.duringExplicitConnectDisconnect--;
    }
  }

  async disconnect(): Promise<void> {
    return this.disconnectInternal(true);
  }

  private async disconnectInternal(
    userTriggered: boolean,
    updateState: boolean = true,
  ): Promise<void> {
    logMessage(
      `Bluetooth disconnect (Capacitor) ${userTriggered ? '(user triggered)' : '(programmatic)'}`,
    );
    this.duringExplicitConnectDisconnect++;
    
    try {
      if (this.deviceId && this.isConnected) {
        await this.bluetoothPlugin.disconnect({ deviceId: this.deviceId });
        this.isConnected = false;
      }
    } catch (e) {
      logError('Bluetooth disconnect error (Capacitor, ignored)', e);
    } finally {
      this.duringExplicitConnectDisconnect--;
    }

    // Clean up notification listeners
    if (this.notificationListeners) {
      for (const [key, listener] of this.notificationListeners.entries()) {
        try {
          await listener.remove();
          logMessage(`Removed notification listener: ${key}`);
        } catch (e) {
          logError(`Failed to remove notification listener ${key}`, e);
        }
      }
      this.notificationListeners.clear();
    }
    
    this.reconnectReadyPromise = new Promise(resolve => setTimeout(resolve, 3_500));
    
    if (updateState) {
      this.inUseAs.forEach(value =>
        stateOnDisconnected(
          value,
          userTriggered || this.finalAttempt
            ? false
            : this.isReconnect
              ? 'autoReconnect'
              : 'connect',
          'bluetooth',
        ),
      );
    }
  }

  async reconnect(finalAttempt: boolean = false): Promise<void> {
    this.finalAttempt = finalAttempt;
    logMessage('Bluetooth reconnect (Capacitor)');
    this.isReconnect = true;
    const as = Array.from(this.inUseAs);
    await this.reconnectReadyPromise;
    await this.connect(...as);
  }

  private async listenToInputServices(): Promise<void> {
    logMessage('listenToInputServices() called - setting up accelerometer, buttons, and UART');
    try {
      await this.listenToAccelerometer();
      logMessage('Accelerometer listener set up');
    } catch (e) {
      logError('Failed to set up accelerometer listener', e);
      throw e;
    }
    try {
      await this.listenToButton('A');
      logMessage('Button A listener set up');
    } catch (e) {
      logError('Failed to set up button A listener', e);
    }
    try {
      await this.listenToButton('B');
      logMessage('Button B listener set up');
    } catch (e) {
      logError('Failed to set up button B listener', e);
    }
    try {
      await this.listenToUART(DeviceRequestStates.INPUT);
      logMessage('UART listener set up');
    } catch (e) {
      logError('Failed to set up UART listener', e);
    }
  }

  private async listenToButton(buttonToListenFor: MBSpecs.Button): Promise<void> {
    if (!this.deviceId) throw new Error('Device not connected');

    const service = MBSpecs.Services.BUTTON_SERVICE;
    const characteristicUuid =
      buttonToListenFor === 'A'
        ? MBSpecs.Characteristics.BUTTON_A
        : MBSpecs.Characteristics.BUTTON_B;
    
    const eventKey = `notification|${this.deviceId}|${service}|${characteristicUuid}`;
    
    // Set up listener
    const listener = await this.bluetoothPlugin.addListener(eventKey, (event: any) => {
      const dataView = this.valueToDataView(event?.value);
      const stateId = dataView.getUint8(0);
      let state = MBSpecs.ButtonStates.Released;
      if (stateId === 1) {
        state = MBSpecs.ButtonStates.Pressed;
      }
      if (stateId === 2) {
        state = MBSpecs.ButtonStates.LongPressed;
      }
      onButtonChange(state, buttonToListenFor);
    });
    
    // Store listener for cleanup
    if (!this.notificationListeners) {
      this.notificationListeners = new Map();
    }
    this.notificationListeners.set(eventKey, listener);
    
    // Start notifications with object format
    await this.bluetoothPlugin.startNotifications({
      deviceId: this.deviceId,
      service: service,
      characteristic: characteristicUuid
    });
  }

  /**
   * Helper to convert value to DataView
   * The plugin may return values in different formats
   */
  private valueToDataView(value: any): DataView {
    let bytes: Uint8Array;
    if (typeof value === 'string') {
      // Value is a hex string (e.g., "001234567890")
      bytes = new Uint8Array(value.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
    } else if (Array.isArray(value)) {
      // Value is an array of numbers
      bytes = new Uint8Array(value);
    } else if (value instanceof DataView) {
      // Already a DataView
      return value;
    } else {
      // Value is already a Uint8Array or ArrayBuffer
      bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    }
    return new DataView(bytes.buffer);
  }

  private async listenToAccelerometer(): Promise<void> {
    if (!this.deviceId) {
      throw new Error('Device not connected - deviceId is not available');
    }

    logMessage('Setting up accelerometer notifications...', {
      deviceId: this.deviceId,
      service: MBSpecs.Services.ACCEL_SERVICE,
      characteristic: MBSpecs.Characteristics.ACCEL_DATA
    });
    
    // The raw plugin API requires:
    // 1. Setting up a listener with the event key: notification|deviceId|service|characteristic
    // 2. Calling startNotifications with an object: {deviceId, service, characteristic}
    try {
      const service = MBSpecs.Services.ACCEL_SERVICE;
      const characteristic = MBSpecs.Characteristics.ACCEL_DATA;
      const eventKey = `notification|${this.deviceId}|${service}|${characteristic}`;
      
      // Set up listener for notifications
      const listener = await this.bluetoothPlugin.addListener(eventKey, (event: any) => {
        // Convert value to DataView (plugin may return different formats)
        const value = event?.value;
        const dataView = this.valueToDataView(value);
        
        // Parse accelerometer data (x, y, z as Int16 little-endian)
        const x = dataView.getInt16(0, true);
        const y = dataView.getInt16(2, true);
        const z = dataView.getInt16(4, true);
        
        logMessage('Accelerometer data received:', { 
          x, 
          y, 
          z,
          valueType: typeof value,
          dataViewLength: dataView.byteLength
        });
        
        // Call the change handler
        onAccelerometerChange(x, y, z);
      });
      
      // Store listener for cleanup
      if (!this.notificationListeners) {
        this.notificationListeners = new Map();
      }
      this.notificationListeners.set(eventKey, listener);
      
      // Start notifications with object format
      await this.bluetoothPlugin.startNotifications({
        deviceId: this.deviceId,
        service: service,
        characteristic: characteristic
      });
      
      logMessage('Accelerometer notifications started successfully');
    } catch (e) {
      logError('Failed to start accelerometer notifications', e);
      throw e;
    }
  }

  private async listenToUART(state: DeviceRequestStates): Promise<void> {
    if (!this.deviceId) throw new Error('Device not connected');

    const service = MBSpecs.Services.UART_SERVICE;
    const characteristic = MBSpecs.Characteristics.UART_DATA_TX;
    const eventKey = `notification|${this.deviceId}|${service}|${characteristic}`;
    
    // Set up listener
    const listener = await this.bluetoothPlugin.addListener(eventKey, (event: any) => {
      const dataView = this.valueToDataView(event?.value);
      const receivedData: number[] = [];
      for (let i = 0; i < dataView.byteLength; i += 1) {
        receivedData[i] = dataView.getUint8(i);
      }
      const receivedString = String.fromCharCode.apply(null, receivedData);
      onUARTDataReceived(state, receivedString);
    });
    
    // Store listener for cleanup
    if (!this.notificationListeners) {
      this.notificationListeners = new Map();
    }
    this.notificationListeners.set(eventKey, listener);
    
    // Start notifications with object format
    await this.bluetoothPlugin.startNotifications({
      deviceId: this.deviceId,
      service: service,
      characteristic: characteristic
    });
  }

  private async listenToOutputServices(): Promise<void> {
    if (!this.deviceId) throw new Error('Device not connected');

    // Get characteristics for output - we just need to store references
    // The actual characteristics will be accessed via the plugin API when writing
    // For now, we'll create placeholder objects that contain the necessary info
    this.outputCharacteristics = {
      io: {
        uuid: MBSpecs.Characteristics.IO_DATA,
        service: MBSpecs.Services.IO_SERVICE,
        deviceId: this.deviceId,
      } as BleCharacteristic,
      matrix: {
        uuid: MBSpecs.Characteristics.LED_MATRIX_STATE,
        service: MBSpecs.Services.LED_SERVICE,
        deviceId: this.deviceId,
      } as BleCharacteristic,
      uart: {
        uuid: MBSpecs.Characteristics.UART_DATA_RX,
        service: MBSpecs.Services.UART_SERVICE,
        deviceId: this.deviceId,
      } as BleCharacteristic,
    };

    await this.listenToUART(DeviceRequestStates.OUTPUT);
  }

  private setPinInternal = (pin: MBSpecs.UsableIOPin, on: boolean): void => {
    this.queueAction(async (outputCharacteristics) => {
      if (!this.deviceId) throw new Error('Device not connected');
      const dataView = new DataView(new ArrayBuffer(2));
      dataView.setInt8(0, pin);
      dataView.setInt8(1, on ? 1 : 0);
      outputting.set({ text: `Turn pin ${pin} ${on ? 'on' : 'off'}` });
      
      const value = new Uint8Array(dataView.buffer);
      await this.bluetoothPlugin.write({
        deviceId: this.deviceId,
        service: MBSpecs.Services.IO_SERVICE,
        characteristic: MBSpecs.Characteristics.IO_DATA,
        value: Array.from(value),
      });
    });
  };

  private pinStateCounters = new Map<MBSpecs.UsableIOPin, number>();

  setPin(pin: MBSpecs.UsableIOPin, on: boolean): void {
    let stateCounter = this.pinStateCounters.get(pin) ?? 0;
    stateCounter = stateCounter + (on ? 1 : -1);
    const changed = stateCounter === 0 || stateCounter === 1;
    this.pinStateCounters.set(pin, Math.max(0, stateCounter));
    if (changed) {
      this.setPinInternal(pin, on);
    }
  }

  resetPins = () => {
    this.pinStateCounters = new Map();
    StaticConfiguration.supportedPins.forEach(value => {
      this.setPinInternal(value, false);
    });
  };

  setLeds = (matrix: boolean[]): void => {
    this.queueAction(async (outputCharacteristics) => {
      if (!this.deviceId) throw new Error('Device not connected');
      const dataView = new DataView(new ArrayBuffer(5));
      for (let i = 0; i < 5; i++) {
        dataView.setUint8(
          i,
          matrix
            .slice(i * 5, 5 + i * 5)
            .reduce((byte, bool) => (byte << 1) | (bool ? 1 : 0), 0),
        );
      }
      const value = new Uint8Array(dataView.buffer);
      await this.bluetoothPlugin.write({
        deviceId: this.deviceId,
        service: MBSpecs.Services.LED_SERVICE,
        characteristic: MBSpecs.Characteristics.LED_MATRIX_STATE,
        value: Array.from(value),
      });
    });
  };

  sendToOutputUart = (type: UARTMessageType, value: string): void => {
    this.queueAction(async (outputCharacteristics) => {
      if (!this.deviceId) throw new Error('Device not connected');
      const view = MBSpecs.Utility.messageToDataview(`${type}_${value}`);
      const valueArray = new Uint8Array(view.buffer);
      await this.bluetoothPlugin.write({
        deviceId: this.deviceId,
        service: MBSpecs.Services.UART_SERVICE,
        characteristic: MBSpecs.Characteristics.UART_DATA_RX,
        value: Array.from(valueArray),
      });
    });
  };

  queueAction = (
    action: (outputCharacteristics: OutputCharacteristics) => Promise<void>,
  ) => {
    this.outputWriteQueue.queue.push(action);
    this.processActionQueue();
  };

  processActionQueue = () => {
    if (!this.outputCharacteristics) {
      this.outputWriteQueue = {
        busy: false,
        queue: [],
      };
      return;
    }
    if (this.outputWriteQueue.busy) {
      return;
    }
    const action = this.outputWriteQueue.queue.shift();
    if (action) {
      this.outputWriteQueue.busy = true;
      action(this.outputCharacteristics)
        .then(() => {
          this.outputWriteQueue.busy = false;
          this.processActionQueue();
        })
        .catch(e => {
          logError('Error processing action queue (Capacitor)', e);
          this.outputWriteQueue.busy = false;
          this.processActionQueue();
        });
    }
  };

  private async getModelNumber(): Promise<MBSpecs.MBVersion> {
    if (!this.deviceId) throw new Error('Device not connected');
    
    try {
      const result = await this.bluetoothPlugin.read({
        deviceId: this.deviceId,
        service: MBSpecs.Services.DEVICE_INFO_SERVICE,
        characteristic: MBSpecs.Characteristics.MODEL_NUMBER,
      });

      const value = result.value;
      if (!value) {
        throw new Error('Could not read model number value');
      }

      let bytes: Uint8Array;
      
      // Handle different value formats from the plugin
      if (typeof value === 'string') {
        // Value is a hex string (e.g., "424243206d6963726f3a626974205632")
        logMessage('Model number value is hex string:', value);
        bytes = new Uint8Array(value.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
      } else if (Array.isArray(value)) {
        // Value is an array of numbers
        bytes = new Uint8Array(value);
      } else {
        // Value is already a Uint8Array or ArrayBuffer
        bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      }

      const decoder = new TextDecoder();
      const decodedModelNumber = decoder.decode(bytes);
      logMessage('Decoded model number:', decodedModelNumber);

      if (decodedModelNumber.toLowerCase() === 'BBC micro:bit'.toLowerCase()) {
        return 1;
      }
      if (decodedModelNumber.toLowerCase().includes('BBC micro:bit v2'.toLowerCase()) || 
          decodedModelNumber.toLowerCase().includes('v2')) {
        return 2;
      }
      throw new Error(`Unexpected model number ${decodedModelNumber}`);
    } catch (e) {
      logError('Could not read model number (Capacitor)', e);
      logError('Model number read error details:', { error: e, value: (e as any)?.value });
      throw new Error('Could not read model number');
    }
  }
}

