# sNeek Mobile (Android + iOS)

A thin **Expo + React Native WebView shell** that loads the live sNeek web app, so
the phone apps have **exactly the same features** as the website — it's the same
app, rendered in a native container with native camera / GPS / push permissions.

## ✅ How "update all 3 at once" works

The apps load the **live web URL** (`EXPO_PUBLIC_WEBAPP_URL`, default
`https://www.sneekholdings.com`). So:

- **Feature changes, fixes, UI, content (99% of updates):** just **deploy the web
  app**. Android + iOS pick it up on the next launch/refresh — **no rebuild, no
  store review.** This is what "update all 3 at once" means day-to-day: I change
  the web app, you deploy it, all three are updated.
- **Native-shell changes only (rare):** app icon, splash screen, permissions, the
  Expo SDK, or store listing. These need a new store build (below).

So when you say "update all 3" in future, I update the **web app** and that's it —
unless the change is one of the rare native-shell items.

## Configuration (env)

Set in `mobile-app/.env` (or EAS project secrets):

```
EXPO_PUBLIC_WEBAPP_URL=https://www.sneekholdings.com
EXPO_PUBLIC_APP_NAME=sNeek
EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER=com.sneek.mobile
EXPO_PUBLIC_ANDROID_PACKAGE=com.sneek.mobile
EXPO_PUBLIC_EAS_PROJECT_ID=<from `eas init`>
```

Native permissions are already declared: camera, microphone, photo library, and
location (iOS `infoPlist` + Android `permissions` in `app.config.ts`) — so guided
photo capture, evidence GPS stamps, and photo/video uploads work in the app.

## One-time setup (you, with your accounts)

Prereqs: a free **Expo** account; **Apple Developer** ($99/yr) for iOS; **Google
Play Developer** ($25 once) for Android.

```bash
cd mobile-app
npm install
npm i -g eas-cli            # or use: npx eas-cli@latest
npx eas login
npx eas init                # creates the EAS project, sets the projectId
```

## Build the apps (cloud — no Mac needed for iOS)

```bash
# Android test APK (sideload to a phone to try it):
npx eas build -p android --profile preview

# Production builds for the stores:
npx eas build -p android --profile production
npx eas build -p ios --profile production     # built on Expo's cloud Macs
```

## Submit to the stores

```bash
npx eas submit -p android      # Google Play
npx eas submit -p ios          # App Store
```

## Local dev / preview

```bash
cd mobile-app
npx expo start                 # open in Expo Go or a dev build
```

## When a native rebuild IS needed

Only for: app icon/splash, permission text, Expo SDK upgrade, new native module,
or store metadata. Bump `version` (and Expo auto-increments the build number on
`production`), then `eas build` + `eas submit` again. Everything else ships by
deploying the web app.
