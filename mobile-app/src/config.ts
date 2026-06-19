import Constants from "expo-constants";

type ExtraConfig = {
  webAppUrl?: string;
  eas?: {
    projectId?: string;
  };
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeWebAppUrl(input: string) {
  try {
    const url = new URL(input);
    return trimTrailingSlash(url.toString());
  } catch {
    return "https://www.sneekholdings.com";
  }
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

export const MOBILE_CONFIG = {
  webAppUrl: normalizeWebAppUrl(extra.webAppUrl || process.env.EXPO_PUBLIC_WEBAPP_URL || "https://www.sneekholdings.com"),
  appVersion: Constants.expoConfig?.version || "1.0.0",
  // The app always opens at the login route (not the public marketing site).
  // If a valid session cookie exists, the web app redirects on to the portal.
  startPath: process.env.EXPO_PUBLIC_START_PATH || "/login",
  projectId:
    extra.eas?.projectId ||
    Constants.easConfig?.projectId ||
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    null
};

export function buildWebUrl(pathOrUrl?: string | null) {
  if (!pathOrUrl) return MOBILE_CONFIG.webAppUrl;
  try {
    return new URL(pathOrUrl, `${MOBILE_CONFIG.webAppUrl}/`).toString();
  } catch {
    return MOBILE_CONFIG.webAppUrl;
  }
}

/** The URL the app launches on — the login page. */
export function buildStartUrl() {
  return buildWebUrl(MOBILE_CONFIG.startPath);
}

export function isInternalWebUrl(url: string) {
  try {
    return new URL(url).origin === new URL(MOBILE_CONFIG.webAppUrl).origin;
  } catch {
    return false;
  }
}
