import type { ExpoConfig } from "expo/config";

const appName = process.env.EXPO_PUBLIC_APP_NAME || "sNeek";
const scheme = process.env.EXPO_PUBLIC_APP_SCHEME || "sneekmobile";
const iosBundleIdentifier =
  process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER || "com.sneek.mobile";
const androidPackage =
  process.env.EXPO_PUBLIC_ANDROID_PACKAGE || "com.sneek.mobile";
const webAppUrl = process.env.EXPO_PUBLIC_WEBAPP_URL || "https://www.sneekholdings.com";
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined;

const config: ExpoConfig = {
  name: appName,
  slug: "sneek-mobile-shell",
  version: "1.0.0",
  orientation: "portrait",
  scheme,
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
    bundleIdentifier: iosBundleIdentifier,
    associatedDomains: []
  },
  android: {
    package: androidPackage,
    edgeToEdgeEnabled: true
  },
  plugins: [
    [
      "expo-notifications",
      {
        color: "#0f5a44",
        defaultChannel: "default"
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
