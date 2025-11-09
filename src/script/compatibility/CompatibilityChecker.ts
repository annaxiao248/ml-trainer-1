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
  console.log('🔍 checkCompatibility() called');
  
  if (localStorage.getItem('isTesting')) {
    console.log('✅ Testing mode - returning all true');
    return { bluetooth: true, usb: true, platformAllowed: true, webGL: true };
  }

  const canvas = document.createElement('canvas');
  // TODO: Handle webgl1 vs webgl2 in relation to threejs
  const webGL = canvas.getContext('webgl') instanceof WebGLRenderingContext;

  const browser = Bowser.getParser(window.navigator.userAgent);
  const browserVersion = browser.getBrowserVersion();
  console.log('🌐 Browser info:', {
    browserName: browser.getBrowserName(),
    browserVersion: browserVersion,
    osName: browser.getOSName(),
    osVersion: browser.getOSVersion(),
    platformType: browser.getPlatform().type,
    userAgent: window.navigator.userAgent
  });
  
  // Check platform first - if we're in a native app, we don't need browser version
  const platform = detectPlatform();
  const isIOS = platform === 'ios';
  const isAndroid = platform === 'android';
  const isNativePlatform = isIOS || isAndroid;
  
  // Only return early if we're NOT in a native app and browser version is missing
  if (!browserVersion && !isNativePlatform) {
    console.log('⚠️ No browser version detected and not in native app');
    return { bluetooth: false, usb: false, platformAllowed: true, webGL: webGL };
  }

  let platformType = browser.getPlatform().type;

  // If platform won't report what it is, just assume desktop (ChromeOS doesnt report it)
  if (platformType == undefined) {
    platformType = 'desktop';
  }
  const isPlatformAllowed = isDevMode || !nonAllowedPlatforms.includes(platformType);

  // Platform detection already done above
  console.log('📱 Platform detection:', {
    detectedPlatform: platform,
    isIOS: isIOS,
    isAndroid: isAndroid,
    isNativePlatform: isNativePlatform
  });
  
  // Check if we're in a native app context (not Safari/Chrome browser)
  // Native apps typically don't have certain browser-only features
  const url = document.URL || window.location.href || (window as any).location?.href || '';
  const urlLower = url.toLowerCase();
  const isCapacitorUrl = urlLower.indexOf('capacitor://') !== -1;
  const isIonicUrl = urlLower.indexOf('ionic://') !== -1;
  const isFileUrl = urlLower.indexOf('file://') !== -1;
  const isNotHttpUrl = urlLower.indexOf('http://') === -1 && urlLower.indexOf('https://') === -1;
  
  // Check for Capacitor in multiple ways
  const hasCapacitor = isCapacitorAvailable();
  const hasWebKitHandlers = (window as any).webkit?.messageHandlers !== undefined;
  const isStandalone = (window.navigator as any).standalone === true;
  
  // If we're on iOS and ANY of these conditions are true, we're in a native app
  const isNativeApp = isIOS && (
    hasCapacitor || 
    hasWebKitHandlers ||
    isStandalone ||
    isCapacitorUrl || 
    isIonicUrl || 
    (isNotHttpUrl && isFileUrl)
  );
  
  const bluetoothAvailable = isWebBluetoothAvailable() || (isIOS && isNativeApp);
  
  // Always log for debugging (not just iOS)
  console.log('🔍 Compatibility Check Details:', {
    isIOS: isIOS,
    platform: platform,
    isCapacitorAvailable: hasCapacitor,
    hasWebKitHandlers: hasWebKitHandlers,
    isStandalone: isStandalone,
    isCapacitorUrl: isCapacitorUrl,
    isIonicUrl: isIonicUrl,
    isFileUrl: isFileUrl,
    isNotHttpUrl: isNotHttpUrl,
    url: url,
    urlLength: url.length,
    isNativeApp: isNativeApp,
    webBluetoothAvailable: isWebBluetoothAvailable(),
    bluetoothAvailable: bluetoothAvailable,
    'window.Capacitor': typeof (window as any).Capacitor !== 'undefined',
    'document.URL': document.URL,
    'window.location.href': window.location?.href,
    'window.location': window.location ? 'exists' : 'null'
  });

  const result = {
    bluetooth: bluetoothAvailable,
    usb: !!navigator.usb,
    platformAllowed: isPlatformAllowed,
    webGL: webGL,
  };
  
  console.log('✅ Compatibility result:', result);
  return result;
}
