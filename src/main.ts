/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */

import App from './App.svelte';
import 'virtual:windi.css';

// Initialize Capacitor if available (for native iOS/Android apps)
if (typeof (window as any).Capacitor !== 'undefined') {
  // Capacitor is available - app is running in native context
  console.log('Capacitor detected - running in native app');
  
  // Initialize Bluetooth LE plugin once globally (iOS requirement)
  // This prevents "XPC connection invalid" errors from repeated initialization
  import('./script/microbit-interfacing/CapacitorMicrobitBluetooth').then((module) => {
    if (module.initializeBluetoothLEOnce) {
      module.initializeBluetoothLEOnce().catch((error) => {
        console.warn('Failed to initialize Bluetooth LE plugin at startup:', error);
        // Don't throw - app can still work, initialization will be retried when needed
      });
    }
  });
}

const app = new App({
  target: document.getElementById('root')!,
});

export default app;
