import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { MOBILE_CONFIG } from "@/config";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

export type PushState = {
  expoPushToken: string | null;
  permissionStatus: Notifications.NotificationPermissionsStatus["status"] | "unavailable";
  lastNotificationPath: string | null;
  notificationError: string | null;
  refreshToken: () => Promise<void>;
};

function extractPathFromNotification(
  response: Notifications.NotificationResponse | null | undefined
) {
  const data = response?.notification?.request?.content?.data as Record<string, unknown> | undefined;
  if (!data) return null;
  if (typeof data.path === "string" && data.path.trim()) return data.path.trim();
  if (typeof data.url === "string" && data.url.trim()) return data.url.trim();
  return null;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
  });
}

export function usePushNotifications(): PushState {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] =
    useState<Notifications.NotificationPermissionsStatus["status"] | "unavailable">(
      "unavailable"
    );
  const [lastNotificationPath, setLastNotificationPath] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);
  const receivedListenerRef = useRef<Notifications.EventSubscription | null>(null);

  async function registerAsync() {
    try {
      setNotificationError(null);
      await ensureAndroidChannel();
      const currentPermissions = await Notifications.getPermissionsAsync();
      let finalStatus = currentPermissions.status;
      if (currentPermissions.status !== "granted") {
        const requested = await Notifications.requestPermissionsAsync();
        finalStatus = requested.status;
      }
      setPermissionStatus(finalStatus);
      if (finalStatus !== "granted") {
        setExpoPushToken(null);
        return;
      }
      if (!MOBILE_CONFIG.projectId) {
        setNotificationError(
          "Missing Expo project ID. Add EXPO_PUBLIC_EAS_PROJECT_ID before testing push notifications."
        );
        return;
      }
      const token = (
        await Notifications.getExpoPushTokenAsync({
          projectId: MOBILE_CONFIG.projectId
        })
      ).data;
      setExpoPushToken(token);
    } catch (error: any) {
      setNotificationError(error?.message ?? "Push registration failed.");
    }
  }

  useEffect(() => {
    void registerAsync();

    receivedListenerRef.current = Notifications.addNotificationReceivedListener(() => {
      // Foreground notifications are already handled by the native banner/list handler.
    });

    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const path = extractPathFromNotification(response);
      if (path) setLastNotificationPath(path);
    });

    return () => {
      receivedListenerRef.current?.remove();
      responseListenerRef.current?.remove();
    };
  }, []);

  return {
    expoPushToken,
    permissionStatus,
    lastNotificationPath,
    notificationError,
    refreshToken: registerAsync
  };
}
