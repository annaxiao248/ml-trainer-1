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
}

const app = new App({
  target: document.getElementById('root')!,
});

export default app;
