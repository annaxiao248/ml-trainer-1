/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */

import Bowser from 'bowser';
import { nonAllowedPlatforms } from './CompatibilityList';
import { isDevMode } from '../environment';
import { isWebBluetoothAvailable, isCapacitorAvailable, detectPlatform } from '../utils/platformDetection';

export type CompatibilityStatus = {
  bluetooth: boolean;
  usb: boolean;
  platformAllowed: boolean;
  webGL: boolean;
};

export function checkCompatibility(): CompatibilityStatus {
  if (localStorage.getItem('isTesting')) {
    return { bluetooth: true, usb: true, platformAllowed: true, webGL: true };
  }

  const canvas = document.createElement('canvas');
  // TODO: Handle webgl1 vs webgl2 in relation to threejs
  const webGL = canvas.getContext('webgl') instanceof WebGLRenderingContext;

  const browser = Bowser.getParser(window.navigator.userAgent);
  const browserVersion = browser.getBrowserVersion();
  if (!browserVersion) {
    return { bluetooth: false, usb: false, platformAllowed: true, webGL: webGL };
  }

  let platformType = browser.getPlatform().type;

  // If platform won't report what it is, just assume desktop (ChromeOS doesnt report it)
  if (platformType == undefined) {
    platformType = 'desktop';
  }
  const isPlatformAllowed = isDevMode || !nonAllowedPlatforms.includes(platformType);

  // Bluetooth is available if:
  // 1. Web Bluetooth is available (Android/Desktop), OR
  // 2. Capacitor is available AND we're on iOS (native app)
  // Note: iOS Safari doesn't support Web Bluetooth, so it requires the native Capacitor app
  const platform = detectPlatform();
  const isIOS = platform === 'ios';
  const bluetoothAvailable = isWebBluetoothAvailable() || (isCapacitorAvailable() && isIOS);

  return {
    bluetooth: bluetoothAvailable,
    usb: !!navigator.usb,
    platformAllowed: isPlatformAllowed,
    webGL: webGL,
  };
}
