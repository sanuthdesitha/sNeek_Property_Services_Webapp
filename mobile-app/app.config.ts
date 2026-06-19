import type { ExpoConfig } from "expo/config";

const appName = process.env.EXPO_PUBLIC_APP_NAME || "sNeek Ops";
const scheme = process.env.EXPO_PUBLIC_APP_SCHEME || "sneekmobile";
const iosBundleIdentifier =
  process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER || "com.sneek.mobile";
const androidPackage =
  process.env.EXPO_PUBLIC_ANDROID_PACKAGE || "com.sneek.mobile";
const webAppUrl = process.env.EXPO_PUBLIC_WEBAPP_URL || "https://www.sneekholdings.com";
// EAS project created under the @sneek-holdings account (`eas init`).
const easProjectId =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID || "629007c8-f4e1-41f9-94cc-4d7a48649633";

const config: ExpoConfig = {
  name: appName,
  slug: "sneek-mobile-shell",
  owner: "sneek-holdings",
  version: "1.0.0",
  orientation: "portrait",
  scheme,
  userInterfaceStyle: "light",
  icon: "./assets/icon.png",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff"
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: iosBundleIdentifier,
    icon: "./assets/icon.png",
    associatedDomains: [],
    infoPlist: {
      // Permission prompts so the web app's guided capture, evidence GPS stamps,
      // and photo/video uploads work inside the WebView shell.
      NSCameraUsageDescription:
        "sNeek needs the camera to take job, QA and maintenance evidence photos.",
      NSMicrophoneUsageDescription:
        "sNeek needs the microphone when you record evidence videos.",
      NSPhotoLibraryUsageDescription:
        "sNeek needs photo access so you can attach photos to jobs and reports.",
      NSPhotoLibraryAddUsageDescription:
        "sNeek saves captured evidence photos to your library when you choose to.",
      NSLocationWhenInUseUsageDescription:
        "sNeek uses your location to stamp evidence photos and verify on-site check-ins.",
      ITSAppUsesNonExemptEncryption: false
    }
  },
  android: {
    package: androidPackage,
    edgeToEdgeEnabled: true,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff"
    },
    permissions: [
      "CAMERA",
      "RECORD_AUDIO",
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "READ_MEDIA_IMAGES",
      "READ_MEDIA_VIDEO",
      "READ_EXTERNAL_STORAGE",
      "WRITE_EXTERNAL_STORAGE"
    ]
  },
  plugins: [
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#0f5a44",
        defaultChannel: "default"
      }
    ],
    [
      "expo-local-authentication",
      {
        faceIDPermission: "sNeek uses Face ID to unlock the app."
      }
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "sNeek uses your location to verify on-site check-ins and stamp evidence photos."
      }
    ],
    [
      "expo-media-library",
      {
        photosPermission:
          "sNeek needs photo access so you can attach photos to jobs and reports.",
        savePhotosPermission:
          "sNeek saves captured evidence photos to your library when you choose to.",
        isAccessMediaLocationEnabled: true
      }
    ]
  ],
  extra: {
    webAppUrl,
    eas: easProjectId
      ? {
          projectId: easProjectId
        }
      : undefined
  }
};

export default config;
