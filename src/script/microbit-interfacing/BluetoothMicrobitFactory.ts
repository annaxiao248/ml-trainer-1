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

    // Use global initialization (don't initialize again)
    try {
      const { initializeBluetoothLEOnce } = await import('./CapacitorMicrobitBluetooth');
      await initializeBluetoothLEOnce();
      logMessage('Bluetooth LE plugin ready');
    } catch (e: any) {
      logError('Failed to ensure Bluetooth LE plugin is initialized', e);
      // Try to continue anyway - might already be initialized
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
            logError('No matching devices found during scan', null);
            resolve(null);
          }
        }
      });
    });

    foundDevice = await Promise.race([deviceFound, scanTimeout]);

    if (!foundDevice || foundDevice === 'timeout') {
      logError('Device not found during scan', null);
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
 * Scans for available micro:bit devices using Capacitor Bluetooth plugin
 * Returns a list of found devices instead of auto-connecting
 */
export async function scanCapacitorBluetoothDevices(): Promise<Array<{ deviceId: string; name?: string; rssi?: number }>> {
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

  // Use global initialization (don't initialize again)
  try {
    const { initializeBluetoothLEOnce } = await import('./CapacitorMicrobitBluetooth');
    await initializeBluetoothLEOnce();
    logMessage('Bluetooth LE plugin ready for scanning');
  } catch (e: any) {
    logError('Failed to ensure Bluetooth LE plugin is initialized', e);
    // Try to continue anyway - might already be initialized
  }

  // The requestLEScan method appears to handle both permissions and scanning
  logMessage('Requesting Bluetooth scan permissions and starting scan...');
  try {
    const permissionResult = await bluetoothPlugin.requestLEScan();
    logMessage('requestLEScan completed successfully');
    // If we get here, scanning should be active
  } catch (permissionError) {
    logMessage('requestLEScan failed, trying alternative approach:', permissionError);
    // The plugin may not have requestLEScan, try direct scanning
    try {
      if (bluetoothPlugin.startScanning) {
        logMessage('Trying startScanning directly...');
        await bluetoothPlugin.startScanning({
          services: [],
          allowDuplicates: false,
        });
        logMessage('startScanning succeeded');
      } else {
        logMessage('No scanning method available');
        throw permissionError;
      }
    } catch (scanError) {
      logMessage('All scanning methods failed');
      throw permissionError;
    }
  }

  const foundDevices: Array<{ deviceId: string; name?: string; rssi?: number }> = [];
  const uniqueDevices = new Set<string>();

  // Scan for a fixed duration
  const scanDuration = 10000; // 10 seconds
  logMessage('Creating scan promise with duration:', scanDuration, 'ms');
  const scanPromise = new Promise<Array<{ deviceId: string; name?: string; rssi?: number }>>((resolve, reject) => {
    logMessage('Scan promise created, setting up timeout');
    logMessage('Setting up scan result listener...');
    const listener = bluetoothPlugin.addListener('onScanResult', (result: any) => {
      try {
        // Extract device info from the result
        const deviceName = result.device?.name || result.localName || result.name;
        const deviceId = result.device?.deviceId || result.deviceId || result.id;
        const rssi = result.rssi;

        logMessage('Processing scan result - Name:', deviceName, 'ID:', deviceId, 'RSSI:', rssi);

        // Check if this is a micro:bit device
        if (deviceName && deviceName.startsWith('BBC micro:bit')) {
          if (deviceId && !uniqueDevices.has(deviceId)) {
            uniqueDevices.add(deviceId);
            foundDevices.push({
              deviceId: deviceId,
              name: deviceName,
              rssi: rssi,
            });
            logMessage('Found micro:bit device:', deviceName, 'RSSI:', rssi, 'ID:', deviceId);
          } else if (deviceId && uniqueDevices.has(deviceId)) {
            logMessage('Micro:bit device already found:', deviceName, 'ID:', deviceId);
          }
        } else {
          logMessage('Non-micro:bit device:', deviceName || 'Unknown');
        }
      } catch (error) {
        logError('Error processing scan result', error);
      }
    });
    logMessage('Scan result listener set up successfully');

    // Stop scanning after duration
    let scanTimeoutId: any;
    const stopScanAndResolve = async () => {
      try {
        logMessage('Timer expired or scan stopping, found devices so far:', foundDevices.length);
        logMessage('Found micro:bit devices:', foundDevices.map(d => ({ name: d.name, rssi: d.rssi })));

        // Remove the timeout to prevent multiple calls
        if (scanTimeoutId) {
          clearTimeout(scanTimeoutId);
        }

        await bluetoothPlugin.removeAllListeners();

        // Try to stop scan using the method that worked for starting
        try {
          if (bluetoothPlugin.stopLEScan) {
            await bluetoothPlugin.stopLEScan();
            logMessage('stopLEScan succeeded');
          } else if (bluetoothPlugin.stopScanning) {
            await bluetoothPlugin.stopScanning();
            logMessage('stopScanning succeeded');
          } else {
            logMessage('No stop scan method available');
          }
        } catch (stopScanError) {
          logMessage('Error stopping scan (non-critical):', stopScanError);
        }

        logMessage('Scan stopped successfully, resolving with devices');
        resolve(foundDevices);
      } catch (stopError) {
        logError('Error in stop scan process', stopError);
        // Still resolve with found devices even if stopping fails
        logMessage('Resolving with devices despite stop error:', foundDevices.length);
        resolve(foundDevices);
      }
    };

    // Set timeout to stop scanning - use longer duration to allow more time for device discovery
    scanTimeoutId = setTimeout(stopScanAndResolve, 3000); // 3 seconds
  });

  return await scanPromise;
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
        logError('Device ID not available', null);
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

/**
 * Factory function to start a Bluetooth connection with a specific device
 * Used when device is selected from a list (iOS flow)
 */
export async function startBluetoothConnectionWithDevice(
  device: { deviceId: string; name?: string; rssi?: number },
  requestState: DeviceRequestStates,
): Promise<MicrobitBluetoothConnection | undefined> {
  try {
    const deviceId = device.deviceId;
    if (!deviceId) {
      logError('Device ID not available', null);
      return undefined;
    }

    // Extract name from device name (e.g., "BBC micro:bit [name]" -> "name")
    let name = 'unknown';
    if (device.name && device.name.startsWith('BBC micro:bit [')) {
      const match = device.name.match(/BBC micro:bit \[([^\]]+)\]/);
      if (match) {
        name = match[1];
      }
    }

    logMessage(`Starting Bluetooth connection with selected device: ${device.name || 'Unknown'} (${deviceId})`);

    // Create device object in the format expected by CapacitorMicrobitBluetooth
    const capacitorDevice = {
      deviceId: deviceId,
      name: device.name,
      // Add other properties that might be expected
    };

    // Reuse connection objects for the same device
    const bluetooth =
      deviceIdToConnection.get(deviceId) ??
      new CapacitorMicrobitBluetooth(name, capacitorDevice);
    deviceIdToConnection.set(deviceId, bluetooth);

    // Wait a short moment after scanning stops before attempting connection
    // But keep it short - iOS doesn't cache advertisement data, so we need to connect quickly
    // while the micro:bit is still advertising
    logMessage('Waiting briefly for Bluetooth stack to be ready after scan...');
    await new Promise(resolve => setTimeout(resolve, 200)); // Short delay - connect quickly while advertising

    logMessage('Calling bluetooth.connect()...');
    await bluetooth.connect(requestState);
    logMessage('Connection successful!');
    return bluetooth;
  } catch (e) {
    logError('Failed to start Bluetooth connection with selected device', e);
    logError('Connection error details:', { message: (e as any)?.message || String(e), type: typeof e, keys: e ? Object.keys(e) : [] });
    return undefined;
  }
}

