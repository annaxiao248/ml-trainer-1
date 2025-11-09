/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */

import Bowser from 'bowser';

export type Platform = 'ios' | 'android' | 'desktop' | 'unknown';

/**
 * Detects the current platform
 */
export function detectPlatform(): Platform {
  console.log('🔍 detectPlatform() called');
  
  // Check if running in Capacitor (native app)
  const isCapacitor = typeof (window as any).Capacitor !== 'undefined';
  console.log('🔍 Capacitor check:', { isCapacitor });
  
  if (isCapacitor) {
    const capacitor = (window as any).Capacitor;
    const platform = capacitor.getPlatform();
    console.log('🔍 Capacitor platform:', platform);
    if (platform === 'ios') {
      console.log('✅ Detected iOS via Capacitor');
      return 'ios';
    }
    if (platform === 'android') {
      console.log('✅ Detected Android via Capacitor');
      return 'android';
    }
  }

  // Fallback to browser detection
  const browser = Bowser.getParser(window.navigator.userAgent);
  const osName = browser.getOSName();
  console.log('🔍 Browser OS detection:', { osName, userAgent: window.navigator.userAgent });
  
  if (osName === 'iOS') {
    console.log('✅ Detected iOS via browser OS name');
    return 'ios';
  }
  if (osName === 'Android') {
    console.log('✅ Detected Android via browser OS name');
    return 'android';
  }
  
  // Check user agent for iOS (more reliable than OS name sometimes)
  const ua = window.navigator.userAgent.toLowerCase();
  console.log('🔍 User agent check:', { ua });
  if (/iphone|ipad|ipod/.test(ua)) {
    console.log('✅ Detected iOS via user agent');
    return 'ios';
  }
  if (/android/.test(ua)) {
    console.log('✅ Detected Android via user agent');
    return 'android';
  }
  
  console.log('⚠️ Defaulting to desktop');
  return 'desktop';
}

/**
 * Checks if Web Bluetooth API is available
 */
export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/**
 * Checks if Capacitor is available
 */
export function isCapacitorAvailable(): boolean {
  // Check multiple ways Capacitor might be available
  if (typeof (window as any).Capacitor !== 'undefined') {
    return true;
  }
  // Check for Capacitor in different locations
  if (typeof (window as any).CapacitorWeb !== 'undefined') {
    return true;
  }
  // Check if we're in a Capacitor app by checking for Capacitor-specific globals
  if (typeof (window as any).Ionic !== 'undefined' && (window as any).Ionic.WebView) {
    return true;
  }
  // Check for Capacitor in the global scope
  if (typeof (globalThis as any).Capacitor !== 'undefined') {
    return true;
  }
  return false;
}

/**
 * Determines which Bluetooth implementation should be used
 */
export function shouldUseCapacitorBluetooth(): boolean {
  const platform = detectPlatform();
  // Use Capacitor Bluetooth on iOS, or if Web Bluetooth is not available
  return platform === 'ios' || (isCapacitorAvailable() && !isWebBluetoothAvailable());
}

