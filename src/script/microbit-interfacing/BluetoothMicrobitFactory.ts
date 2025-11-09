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

    // Request permissions
    const permissionResult = await bluetoothPlugin.requestLEScan();
    if (!permissionResult) {
      throw new Error('Bluetooth scan permission denied');
    }

    // Start scanning
    logMessage('Starting Bluetooth scan for micro:bit...');
    await bluetoothPlugin.startLEScan({
      services: [],
      allowDuplicates: false,
    });

    // Wait for device to be found
    const deviceName = `BBC micro:bit [${name}]`;
    let foundDevice: any = null;

    const scanTimeout = new Promise<'timeout'>(resolve =>
      setTimeout(() => resolve('timeout'), StaticConfiguration.requestDeviceTimeoutDuration)
    );

    const deviceFound = new Promise<any>((resolve) => {
      const listener = bluetoothPlugin.addListener('onScanResult', (result: any) => {
        if (result.name === deviceName || result.name?.startsWith(`BBC micro:bit [${name}]`)) {
          bluetoothPlugin.removeAllListeners();
          bluetoothPlugin.stopLEScan();
          resolve(result);
        }
      });

      // Cleanup on timeout
      scanTimeout.then((result) => {
        if (result === 'timeout') {
          bluetoothPlugin.removeAllListeners();
          bluetoothPlugin.stopLEScan();
          resolve(null);
        }
      });
    });

    foundDevice = await Promise.race([deviceFound, scanTimeout]);

    if (!foundDevice || foundDevice === 'timeout') {
      logError('Device not found during scan');
      return undefined;
    }

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

