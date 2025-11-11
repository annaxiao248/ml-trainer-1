/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */

import StaticConfiguration from '../../StaticConfiguration';
import { logError, logMessage } from '../utils/logging';
import { shouldUseCapacitorBluetooth, isWebBluetoothAvailable } from '../utils/platformDetection';
import { btSelectMicrobitDialogOnLoad } from '../stores/connectionStore';
import MBSpecs from './MBSpecs';
import MicrobitConnection, { DeviceRequestStates } from './MicrobitConnection';
import { WebMicrobitBluetooth } from './WebMicrobitBluetooth';
import { CapacitorMicrobitBluetooth } from './CapacitorMicrobitBluetooth';

// Union type for both implementations
export type MicrobitBluetoothConnection = WebMicrobitBluetooth | CapacitorMicrobitBluetooth;

const deviceIdToConnection: Map<string, MicrobitBluetoothConnection> = new Map();

/**
 * Requests a Bluetooth device using Web Bluetooth API
 */
async function requestWebBluetoothDevice(name: string): Promise<BluetoothDevice | undefined> {
  try {
    if (!isWebBluetoothAvailable()) {
      throw new Error('Web Bluetooth API is not available');
    }

    const result = await Promise.race([
      navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: `BBC micro:bit [${name}]` }],
        optionalServices: [
          MBSpecs.Services.UART_SERVICE,
          MBSpecs.Services.ACCEL_SERVICE,
          MBSpecs.Services.DEVICE_INFO_SERVICE,
          MBSpecs.Services.LED_SERVICE,
          MBSpecs.Services.IO_SERVICE,
          MBSpecs.Services.BUTTON_SERVICE,
        ],
      }),
      new Promise<'timeout'>(resolve =>
        setTimeout(
          () => resolve('timeout'),
          StaticConfiguration.requestDeviceTimeoutDuration,
        ),
      ),
    ]);
    
    if (result === 'timeout') {
      btSelectMicrobitDialogOnLoad.set(true);
      window.location.reload();
      return undefined;
    }
    return result as BluetoothDevice;
  } catch (e) {
    logError('Web Bluetooth request device failed/cancelled', e);
    return undefined;
  }
}

/**
 * Requests a Bluetooth device using Capacitor Bluetooth plugin
 */
async function requestCapacitorBluetoothDevice(name: string): Promise<any | undefined> {
  try {
    const Capacitor = (window as any).Capacitor;
    if (!Capacitor) {
      throw new Error('Capacitor is not available');
    }

    // Try to get the Bluetooth LE plugin
    let bluetoothPlugin: any;
    try {
      bluetoothPlugin = Capacitor.Plugins.BluetoothLe || 
                       (window as any).BluetoothLe ||
                       require('@capacitor-community/bluetooth-le').BluetoothLe;
    } catch (e) {
      throw new Error('Bluetooth LE plugin not available. Please install @capacitor-community/bluetooth-le');
    }

    // Initialize the Bluetooth LE plugin first
    logMessage('Initializing Bluetooth LE plugin...');
    try {
      await bluetoothPlugin.initialize();
      logMessage('Bluetooth LE plugin initialized');
    } catch (e: any) {
      // If already initialized, that's fine
      if (e.message && e.message.includes('already initialized')) {
        logMessage('Bluetooth LE plugin already initialized');
      } else {
        logError('Failed to initialize Bluetooth LE plugin', e);
        // Try to continue anyway - might already be initialized
      }
    }

    // Request permissions
    logMessage('Requesting Bluetooth scan permissions...');
    const permissionResult = await bluetoothPlugin.requestLEScan();
    if (!permissionResult) {
      throw new Error('Bluetooth scan permission denied');
    }
    logMessage('Bluetooth scan permissions granted');

    // Start scanning
    logMessage('Starting Bluetooth scan for micro:bit...');
    await bluetoothPlugin.startLEScan({
      services: [],
      allowDuplicates: false,
    });

    // Wait for device to be found
    const deviceName = `BBC micro:bit [${name}]`;
    const namePrefix = `BBC micro:bit [${name}]`;
    let foundDevice: any = null;
    const foundDevices: any[] = [];

    const scanTimeout = new Promise<'timeout'>(resolve =>
      setTimeout(() => resolve('timeout'), StaticConfiguration.requestDeviceTimeoutDuration)
    );

    const deviceFound = new Promise<any>((resolve) => {
      const listener = bluetoothPlugin.addListener('onScanResult', (result: any) => {
        logMessage('Scan result received:', result);
        
        // Check if this is a micro:bit device matching our name
        if (result.name && (
          result.name === deviceName || 
          result.name.startsWith(namePrefix) ||
          result.name.startsWith('BBC micro:bit [')
        )) {
          logMessage('Found matching micro:bit device:', result.name);
          foundDevices.push(result);
          
          // If we found an exact match, use it immediately
          if (result.name === deviceName) {
            logMessage('Found exact match, stopping scan');
            bluetoothPlugin.removeAllListeners();
            bluetoothPlugin.stopLEScan();
            resolve(result);
            return;
          }
        }
      });

      // Cleanup on timeout
      scanTimeout.then((result) => {
        if (result === 'timeout') {
          logMessage('Scan timeout reached');
          bluetoothPlugin.removeAllListeners();
          bluetoothPlugin.stopLEScan();
          
          // If we found any matching devices, use the first one
          if (foundDevices.length > 0) {
            logMessage(`Found ${foundDevices.length} matching device(s), using first one`);
            resolve(foundDevices[0]);
          } else {
            logError('No matching devices found during scan');
            resolve(null);
          }
        }
      });
    });

    foundDevice = await Promise.race([deviceFound, scanTimeout]);

    if (!foundDevice || foundDevice === 'timeout') {
      logError('Device not found during scan');
      return undefined;
    }

    logMessage('Selected device:', foundDevice);
    return foundDevice;
  } catch (e) {
    logError('Capacitor Bluetooth request device failed', e);
    return undefined;
  }
}

/**
 * Factory function to start a Bluetooth connection
 * Automatically selects the appropriate implementation based on platform
 */
export async function startBluetoothConnection(
  name: string,
  requestState: DeviceRequestStates,
): Promise<MicrobitBluetoothConnection | undefined> {
  const useCapacitor = shouldUseCapacitorBluetooth();
  
  logMessage(`Starting Bluetooth connection using ${useCapacitor ? 'Capacitor' : 'Web Bluetooth'}`);

  try {
    if (useCapacitor) {
      // Use Capacitor Bluetooth for iOS
      const device = await requestCapacitorBluetoothDevice(name);
      if (!device) {
        return undefined;
      }

      const deviceId = device.deviceId || device.id;
      if (!deviceId) {
        logError('Device ID not available');
        return undefined;
      }

      // Reuse connection objects for the same device
      const bluetooth =
        deviceIdToConnection.get(deviceId) ??
        new CapacitorMicrobitBluetooth(name, device);
      deviceIdToConnection.set(deviceId, bluetooth);
      await bluetooth.connect(requestState);
      return bluetooth;
    } else {
      // Use Web Bluetooth for Android/Desktop
      const device = await requestWebBluetoothDevice(name);
      if (!device) {
        return undefined;
      }

      // Reuse connection objects for the same device
      const bluetooth =
        deviceIdToConnection.get(device.id) ??
        new WebMicrobitBluetooth(name, device);
      deviceIdToConnection.set(device.id, bluetooth);
      await bluetooth.connect(requestState);
      return bluetooth;
    }
  } catch (e) {
    logError('Failed to start Bluetooth connection', e);
    return undefined;
  }
}

