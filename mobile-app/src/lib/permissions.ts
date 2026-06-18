import * as Notifications from "expo-notifications";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";

export type PermissionKey = "notifications" | "location" | "media";
export type PermissionResult = "granted" | "denied" | "unavailable";
export type PermissionResults = Record<PermissionKey, PermissionResult>;

function toResult(status: string | null | undefined): PermissionResult {
  return status === "granted" ? "granted" : "denied";
}

async function requestNotifications(): Promise<PermissionResult> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === "granted") return "granted";
    const requested = await Notifications.requestPermissionsAsync();
    return toResult(requested.status);
  } catch {
    return "unavailable";
  }
}

async function requestLocation(): Promise<PermissionResult> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === "granted") return "granted";
    const requested = await Location.requestForegroundPermissionsAsync();
    return toResult(requested.status);
  } catch {
    return "unavailable";
  }
}

async function requestMedia(): Promise<PermissionResult> {
  try {
    const current = await MediaLibrary.getPermissionsAsync();
    if (current.status === "granted") return "granted";
    const requested = await MediaLibrary.requestPermissionsAsync();
    return toResult(requested.status);
  } catch {
    return "unavailable";
  }
}

/**
 * Requests notifications, location and photo/file access up front (during
 * onboarding). Each request is independent — a denial of one never blocks the
 * others. Camera/microphone are requested by the WebView the first time guided
 * capture runs, so they are not prompted here.
 */
export async function requestAllPermissions(): Promise<PermissionResults> {
  const [notifications, location, media] = await Promise.all([
    requestNotifications(),
    requestLocation(),
    requestMedia(),
  ]);
  return { notifications, location, media };
}
