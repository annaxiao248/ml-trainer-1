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
  // Check if running in Capacitor (native app)
  const isCapacitor = typeof (window as any).Capacitor !== 'undefined';
  
  if (isCapacitor) {
    const capacitor = (window as any).Capacitor;
    const platform = capacitor.getPlatform();
    if (platform === 'ios') return 'ios';
    if (platform === 'android') return 'android';
  }

  // Fallback to browser detection
  const browser = Bowser.getParser(window.navigator.userAgent);
  const osName = browser.getOSName();
  
  if (osName === 'iOS') return 'ios';
  if (osName === 'Android') return 'android';
  
  // Check user agent for iOS (more reliable than OS name sometimes)
  const ua = window.navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  
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
  return typeof (window as any).Capacitor !== 'undefined';
}

/**
 * Determines which Bluetooth implementation should be used
 */
export function shouldUseCapacitorBluetooth(): boolean {
  const platform = detectPlatform();
  // Use Capacitor Bluetooth on iOS, or if Web Bluetooth is not available
  return platform === 'ios' || (isCapacitorAvailable() && !isWebBluetoothAvailable());
}

