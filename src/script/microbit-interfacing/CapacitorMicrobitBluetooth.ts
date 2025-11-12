/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */

import StaticConfiguration from '../../StaticConfiguration';
import { outputting, state } from '../stores/uiStore';
import { get } from 'svelte/store';
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
      await bluetoothPlugin.initialize();
      bluetoothInitialized = true;
    } catch (e: any) {
      // If already initialized, that's fine
      if (e.message && e.message.includes('already initialized')) {
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
        if (authStatus && authStatus !== 'granted' && authStatus !== 'allowed') {
          // Authorization may not be granted
        }
      }
    } catch (authError) {
      // Ignore authorization check errors
    }
  }

  async connect(...states: DeviceRequestStates[]): Promise<void> {
    logEvent({
      type: this.isReconnect ? 'Reconnect' : 'Connect',
      action: 'Bluetooth connect start (Capacitor)',
      states,
    });

    if (this.duringExplicitConnectDisconnect) {
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
          if (!isEnabled) {
            throw new Error('Bluetooth is not enabled on the device. Please enable Bluetooth in iOS Settings.');
          }
        }
      } catch (enableError) {
        // Ignore enable check errors
      }

      // Verify plugin is working by checking available methods
      // logMessage('Bluetooth plugin methods available:', {
      //   hasConnect: typeof this.bluetoothPlugin.connect === 'function',
      //   hasIsConnected: typeof this.bluetoothPlugin.isConnected === 'function',
      //   hasDisconnect: typeof this.bluetoothPlugin.disconnect === 'function',
      //   pluginKeys: Object.keys(this.bluetoothPlugin || {})
      // });

      // Check if device is already connected using getConnectedDevices
      let isAlreadyConnected = false;
      try {
        if (this.bluetoothPlugin.getConnectedDevices) {
          const connectedDevices = await this.bluetoothPlugin.getConnectedDevices({
            services: [] // Empty array to get all connected devices
          });
          if (connectedDevices && Array.isArray(connectedDevices)) {
            isAlreadyConnected = connectedDevices.some((device: any) => 
              (device.deviceId || device.id) === this.deviceId
            );
          }
        }
      } catch (checkError) {
        // Ignore connection check errors
      }

      if (!isAlreadyConnected) {
        // Retry connection up to 2 times with delays
        const maxRetries = 2;
        let lastError: any = null;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (attempt > 0) {
            try {
              await this.bluetoothPlugin.disconnect({ deviceId: this.deviceId });
            } catch (disconnectError) {
              // Ignore disconnect errors
            }
            
            const delay = 2000 + (1000 * attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
          }

          try {
            const connectionTimeout = StaticConfiguration.connectTimeoutDuration * 1.5;
            
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

            await this.bluetoothPlugin.connect(connectOptionsWithServices);
            await new Promise(resolve => setTimeout(resolve, 500));
            break;
            
          } catch (connectError: any) {
            lastError = connectError;
            if (attempt === maxRetries) {
              const errorMessage = connectError?.message || connectError?.errorMessage || String(connectError);
              if (errorMessage.includes('timeout') || errorMessage.includes('Connection timeout')) {
                throw new Error('Connection timeout after multiple attempts. Please ensure the micro:bit is in pairing mode and try again.');
              }
              throw connectError;
            }
          }
        }
        
        if (lastError && !this.isConnected) {
          throw lastError;
        }
      }

      this.isConnected = true;

      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        if (this.bluetoothPlugin.discoverServices) {
          await this.bluetoothPlugin.discoverServices({
            deviceId: this.deviceId,
            services: [
              MBSpecs.Services.DEVICE_INFO_SERVICE,
              MBSpecs.Services.ACCEL_SERVICE,
              MBSpecs.Services.BUTTON_SERVICE,
              MBSpecs.Services.UART_SERVICE,
              MBSpecs.Services.LED_SERVICE,
              MBSpecs.Services.IO_SERVICE,
            ],
          });
        }
      } catch (discoverError: any) {
        // Continue anyway - service discovery may not be necessary
      }

      await new Promise(resolve => setTimeout(resolve, 300));

      // Get model number
      let microbitVersion: MBSpecs.MBVersion;
      try {
        microbitVersion = await this.getModelNumber();
      } catch (modelError: any) {
        await new Promise(resolve => setTimeout(resolve, 500));
        microbitVersion = await this.getModelNumber();
      }

      states.forEach(stateOnConnected);
      
      if (states.includes(DeviceRequestStates.INPUT)) {
        await this.listenToInputServices();
      }
      if (states.includes(DeviceRequestStates.OUTPUT)) {
        await this.listenToOutputServices();
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
    this.duringExplicitConnectDisconnect++;
    
    // Store states and connection status before any cleanup
    const statesToDisconnect = Array.from(this.inUseAs);
    const wasConnected = this.isConnected;
    
    // Stop notifications first
    if (this.notificationListeners && this.deviceId) {
      for (const [key, listener] of this.notificationListeners.entries()) {
        try {
          // Extract service and characteristic from the event key: notification|deviceId|service|characteristic
          const parts = key.split('|');
          if (parts.length === 4) {
            const [, , service, characteristic] = parts;
            await this.bluetoothPlugin.stopNotifications({
              deviceId: this.deviceId,
              service: service,
              characteristic: characteristic
            });
          }
          await listener.remove();
        } catch (e) {
          // Ignore errors during cleanup
        }
      }
      this.notificationListeners.clear();
    }
    
    try {
      if (this.deviceId && wasConnected) {
        await this.bluetoothPlugin.disconnect({ deviceId: this.deviceId });
        this.isConnected = false;
      }
    } catch (e) {
      logError('Bluetooth disconnect error (Capacitor)', e);
    } finally {
      this.duringExplicitConnectDisconnect--;
    }
    
    // Clear inUseAs after storing states
    this.inUseAs.clear();
    
    this.reconnectReadyPromise = new Promise(resolve => setTimeout(resolve, 3_500));
    
    if (updateState) {
      if (statesToDisconnect.length > 0) {
        statesToDisconnect.forEach(value =>
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
      } else if (wasConnected) {
        // If inUseAs was empty but we were connected, disconnect INPUT as fallback
        // This can happen if the state tracking got out of sync
        stateOnDisconnected(
          DeviceRequestStates.INPUT,
          userTriggered ? false : 'connect',
          'bluetooth',
        );
      }
    }
  }

  async reconnect(finalAttempt: boolean = false): Promise<void> {
    this.finalAttempt = finalAttempt;
    this.isReconnect = true;
    
    // Restore inUseAs from reconnect state since it was cleared during disconnect
    const reconnectState = get(state).reconnectState;
    if (reconnectState.inUseAs.size > 0) {
      this.inUseAs = new Set(reconnectState.inUseAs);
    }
    
    const as = Array.from(this.inUseAs);
    await this.reconnectReadyPromise;
    await this.connect(...as);
  }

  private async listenToInputServices(): Promise<void> {
    try {
      await this.listenToAccelerometer();
    } catch (e) {
      logError('Failed to set up accelerometer listener', e);
      throw e;
    }
    try {
      await this.listenToButton('A');
    } catch (e) {
      // Ignore button errors
    }
    try {
      await this.listenToButton('B');
    } catch (e) {
      // Ignore button errors
    }
    try {
      await this.listenToUART(DeviceRequestStates.INPUT);
    } catch (e) {
      // Ignore UART errors
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
      throw new Error('Could not read model number');
    }
  }
}

