# iOS Bluetooth Support Setup Guide

This guide explains how to set up iOS Bluetooth support for the micro:bit ML Trainer application.

## Overview

The application now supports Bluetooth connections on both iOS and Android/Desktop devices:
- **Android/Desktop**: Uses Web Bluetooth API (existing functionality)
- **iOS**: Uses Capacitor Bluetooth LE plugin (new functionality)

The application automatically detects the platform and uses the appropriate Bluetooth implementation.

## Prerequisites

1. Node.js and npm installed
2. Capacitor CLI installed globally (optional, but recommended)
3. Xcode installed (for iOS development)
4. iOS device or simulator for testing

## Installation Steps

### 1. Install Capacitor (if not already installed)

```bash
npm install @capacitor/core @capacitor/cli
npm install @capacitor/ios
```

### 2. Install Bluetooth LE Plugin

```bash
npm install @capacitor-community/bluetooth-le
```

### 3. Initialize Capacitor (if not already done)

```bash
npx cap init
```

Follow the prompts to configure your app.

### 4. Add iOS Platform (if not already added)

```bash
npx cap add ios
```

### 5. Sync Capacitor

```bash
npx cap sync ios
```

### 6. Configure iOS Permissions

Add the following to `ios/App/App/Info.plist`:

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>This app needs Bluetooth access to connect to micro:bit devices</string>
<key>NSBluetoothPeripheralUsageDescription</key>
<string>This app needs Bluetooth access to connect to micro:bit devices</string>
```

### 7. Build and Run

```bash
# Build the web app
npm run build

# Sync to iOS
npx cap sync ios

# Open in Xcode
npx cap open ios
```

Then build and run from Xcode.

## How It Works

### Platform Detection

The application uses `src/script/utils/platformDetection.ts` to detect the current platform:
- Checks if Capacitor is available
- Detects iOS vs Android vs Desktop
- Determines which Bluetooth implementation to use

### Factory Pattern

The `BluetoothMicrobitFactory` (`src/script/microbit-interfacing/BluetoothMicrobitFactory.ts`) automatically selects the appropriate implementation:
- **WebMicrobitBluetooth**: For Android/Desktop (uses Web Bluetooth API)
- **CapacitorMicrobitBluetooth**: For iOS (uses Capacitor Bluetooth LE plugin)

### Code Structure

- `WebMicrobitBluetooth.ts`: Web Bluetooth implementation (Android/Desktop)
- `CapacitorMicrobitBluetooth.ts`: Capacitor Bluetooth implementation (iOS)
- `BluetoothMicrobitFactory.ts`: Factory that selects the appropriate implementation
- `platformDetection.ts`: Platform detection utilities

## Testing

### Testing on iOS Device

1. Connect your iOS device to your Mac
2. Open the project in Xcode
3. Select your device as the build target
4. Build and run the app
5. Test Bluetooth connection to micro:bit

### Testing on Android/Desktop

The existing Web Bluetooth functionality should continue to work as before.

## Troubleshooting

### Bluetooth Plugin Not Found

If you see an error about the Bluetooth plugin not being available:
1. Make sure `@capacitor-community/bluetooth-le` is installed
2. Run `npx cap sync ios` to sync the plugin
3. Rebuild the iOS app

### Permissions Not Working

1. Check that the Info.plist contains the Bluetooth usage descriptions
2. Make sure you've run `npx cap sync ios` after adding permissions
3. Check iOS Settings > Privacy & Security > Bluetooth to ensure permissions are granted

### Connection Issues

1. Make sure the micro:bit is powered on and in pairing mode
2. Check that Bluetooth is enabled on your iOS device
3. Verify the micro:bit name matches what you're searching for
4. Check the console logs for detailed error messages

## Notes

- The Capacitor Bluetooth implementation uses the same interface as the Web Bluetooth implementation, so existing code should work without changes
- Both implementations support the same features: accelerometer data, button presses, LED control, pin control, and UART communication
- The factory pattern ensures backward compatibility with existing code

