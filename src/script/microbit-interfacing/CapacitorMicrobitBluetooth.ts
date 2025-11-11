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
  private notificationCallbacks: Map<string, (value: DataView) => void> = new Map();
  private isConnected = false;

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
   * Initialize the Bluetooth LE plugin if not already initialized
   */
  private async ensureInitialized(): Promise<void> {
    try {
      await this.bluetoothPlugin.initialize();
      logMessage('Bluetooth LE plugin initialized');
    } catch (e: any) {
      // If already initialized, that's fine
      if (e.message && e.message.includes('already initialized')) {
        logMessage('Bluetooth LE plugin already initialized');
      } else {
        logError('Failed to initialize Bluetooth LE plugin', e);
        throw e;
      }
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

      // Connect to the device
      logMessage('Connecting to device via Capacitor Bluetooth');
      await this.bluetoothPlugin.connect({
        deviceId: this.deviceId,
        timeout: 5000 // 5 second timeout for connection (shorter)
      });

      this.isConnected = true;
      logMessage('Device connected via Capacitor Bluetooth');

      // Get model number
      const microbitVersion = await this.getModelNumber();

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

    this.notificationCallbacks.clear();
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
    await this.listenToAccelerometer();
    await this.listenToButton('A');
    await this.listenToButton('B');
    await this.listenToUART(DeviceRequestStates.INPUT);
  }

  private async listenToButton(buttonToListenFor: MBSpecs.Button): Promise<void> {
    if (!this.deviceId) throw new Error('Device not connected');

    const characteristicUuid =
      buttonToListenFor === 'A'
        ? MBSpecs.Characteristics.BUTTON_A
        : MBSpecs.Characteristics.BUTTON_B;

    // Start notifications
    await this.bluetoothPlugin.startNotifications({
      deviceId: this.deviceId,
      service: MBSpecs.Services.BUTTON_SERVICE,
      characteristic: characteristicUuid,
    });

    // Set up callback for notifications
    const callbackKey = `${MBSpecs.Services.BUTTON_SERVICE}-${characteristicUuid}`;
    this.notificationCallbacks.set(callbackKey, (value: DataView) => {
      const stateId = value.getUint8(0);
      let state = MBSpecs.ButtonStates.Released;
      if (stateId === 1) {
        state = MBSpecs.ButtonStates.Pressed;
      }
      if (stateId === 2) {
        state = MBSpecs.ButtonStates.LongPressed;
      }
      onButtonChange(state, buttonToListenFor);
    });

    // Listen for characteristic value changes
    this.bluetoothPlugin.addListener('onCharacteristicChanged', (result: any) => {
      if (result.characteristic === characteristicUuid && result.deviceId === this.deviceId) {
        const callback = this.notificationCallbacks.get(callbackKey);
        if (callback && result.value) {
          const dataView = new DataView(
            new Uint8Array(result.value).buffer
          );
          callback(dataView);
        }
      }
    });
  }

  private async listenToAccelerometer(): Promise<void> {
    if (!this.deviceId) throw new Error('Device not connected');

    // Start notifications
    await this.bluetoothPlugin.startNotifications({
      deviceId: this.deviceId,
      service: MBSpecs.Services.ACCEL_SERVICE,
      characteristic: MBSpecs.Characteristics.ACCEL_DATA,
    });

    // Set up callback for notifications
    const callbackKey = `${MBSpecs.Services.ACCEL_SERVICE}-${MBSpecs.Characteristics.ACCEL_DATA}`;
    this.notificationCallbacks.set(callbackKey, (value: DataView) => {
      const x = value.getInt16(0, true);
      const y = value.getInt16(2, true);
      const z = value.getInt16(4, true);
      onAccelerometerChange(x, y, z);
    });

    // Listen for characteristic value changes
    this.bluetoothPlugin.addListener('onCharacteristicChanged', (result: any) => {
      if (
        result.characteristic === MBSpecs.Characteristics.ACCEL_DATA &&
        result.deviceId === this.deviceId
      ) {
        const callback = this.notificationCallbacks.get(callbackKey);
        if (callback && result.value) {
          const dataView = new DataView(
            new Uint8Array(result.value).buffer
          );
          callback(dataView);
        }
      }
    });
  }

  private async listenToUART(state: DeviceRequestStates): Promise<void> {
    if (!this.deviceId) throw new Error('Device not connected');

    // Start notifications
    await this.bluetoothPlugin.startNotifications({
      deviceId: this.deviceId,
      service: MBSpecs.Services.UART_SERVICE,
      characteristic: MBSpecs.Characteristics.UART_DATA_TX,
    });

    // Set up callback for notifications
    const callbackKey = `${MBSpecs.Services.UART_SERVICE}-${MBSpecs.Characteristics.UART_DATA_TX}`;
    this.notificationCallbacks.set(callbackKey, (value: DataView) => {
      const receivedData: number[] = [];
      for (let i = 0; i < value.byteLength; i += 1) {
        receivedData[i] = value.getUint8(i);
      }
      const receivedString = String.fromCharCode.apply(null, receivedData);
      onUARTDataReceived(state, receivedString);
    });

    // Listen for characteristic value changes
    this.bluetoothPlugin.addListener('onCharacteristicChanged', (result: any) => {
      if (
        result.characteristic === MBSpecs.Characteristics.UART_DATA_TX &&
        result.deviceId === this.deviceId
      ) {
        const callback = this.notificationCallbacks.get(callbackKey);
        if (callback && result.value) {
          const dataView = new DataView(
            new Uint8Array(result.value).buffer
          );
          callback(dataView);
        }
      }
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

      const dataView = new DataView(new Uint8Array(value).buffer);
      const decoder = new TextDecoder();
      const decodedModelNumber = decoder.decode(dataView);

      if (decodedModelNumber.toLowerCase() === 'BBC micro:bit'.toLowerCase()) {
        return 1;
      }
      if (decodedModelNumber.toLowerCase().includes('BBC micro:bit v2'.toLowerCase())) {
        return 2;
      }
      throw new Error(`Unexpected model number ${decodedModelNumber}`);
    } catch (e) {
      logError('Could not read model number (Capacitor)', e);
      throw new Error('Could not read model number');
    }
  }
}

