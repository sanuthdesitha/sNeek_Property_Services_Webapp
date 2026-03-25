# sNeek Mobile Shell

Native Android/iOS wrapper for the hosted sNeek web app.

This app is intentionally thin:
- it loads the live hosted web app inside a native `WebView`
- most feature updates happen automatically because the real product still runs from the hosted website
- native notification registration is handled in the app
- notification taps can push the user into a target web path inside the app

## Why this approach

This matches your current product shape:
- one live web app
- one backend
- one deployment flow

It avoids maintaining a second product UI in React Native.

## What updates automatically

If you change the hosted web app:
- Android app users see the change immediately
- iPhone app users see the change immediately

Because the mobile shell loads the hosted site, normal UI and workflow changes do not require a new app build.

## What still requires a new mobile build

Native-only changes still require a new binary:
- changing notification plugins/config
- changing app icons/splash/native permissions
- changing bundle IDs/package names
- adding more native modules

## Notification model

The app already does the native side:
- requests notification permission
- gets an Expo push token
- handles notification taps
- injects native push context into the web app

The web app/backend still needs one server-side piece to fully use it:
- save the Expo push token against the signed-in user/device
- send push payloads when your existing web/email/SMS notification flows trigger

The app injects this object into the loaded page:

```ts
window.__SNEEK_NATIVE_CONTEXT__ = {
  platform: "ios" | "android",
  appVersion: string,
  webAppUrl: string,
  expoPushToken: string | null,
  notificationPermission: string,
  notificationError: string | null
};
```

It also dispatches:

```ts
window.dispatchEvent(new CustomEvent("sneek-native-context", { detail: payload }));
```

## Environment

Copy:

```bash
cp .env.example .env
```

Set:

```env
EXPO_PUBLIC_WEBAPP_URL=https://www.sneekholdings.com
EXPO_PUBLIC_APP_NAME=sNeek
EXPO_PUBLIC_APP_SCHEME=sneekmobile
EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER=com.sneek.mobile
EXPO_PUBLIC_ANDROID_PACKAGE=com.sneek.mobile
EXPO_PUBLIC_EAS_PROJECT_ID=YOUR_EXPO_PROJECT_ID
```

## Install

From `mobile-app`:

```bash
npm install
```

## Run locally

```bash
npm run start
```

Then:
- `a` for Android
- `i` for iOS

For push notifications on Android SDK 53+:
- use a development build, not Expo Go

Expo docs used:
- WebView install/use: `https://docs.expo.dev/versions/latest/sdk/webview/`
- Notifications: `https://docs.expo.dev/versions/latest/sdk/notifications/`
- Push setup: `https://docs.expo.dev/push-notifications/push-notifications-setup/`
- EAS Update: `https://docs.expo.dev/eas-update/introduction/`
- SDK/React Native compatibility: `https://docs.expo.dev/versions/v54.0.0`

## Build for app stores

Install EAS CLI:

```bash
npm install -g eas-cli
```

Log in:

```bash
eas login
```

Configure project:

```bash
eas init
```

Development build:

```bash
eas build --platform android --profile development
eas build --platform ios --profile development
```

Production build:

```bash
eas build --platform android --profile production
eas build --platform ios --profile production
```

## OTA updates for the shell

If you later want OTA updates for changes inside this mobile wrapper itself:

1. install/configure `expo-updates`
2. run `eas update:configure`
3. publish updates with `eas update`

For now, the hosted web app already gives you central updates for the actual product workflows.

## Recommended next backend step

Add a web endpoint in the main app to accept/store:
- Expo push token
- platform
- app version

Then map your existing notification system to:
- email
- SMS
- web
- mobile push

The mobile shell is ready for that integration.
