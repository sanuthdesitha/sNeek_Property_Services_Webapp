"use client";

import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

type NativeContextPayload = {
  expoPushToken?: string | null;
  platform?: string | null;
  appVersion?: string | null;
};

declare global {
  interface Window {
    __SNEEK_NATIVE_CONTEXT__?: NativeContextPayload;
  }
}

function readNativeContext(): NativeContextPayload | null {
  if (typeof window === "undefined") return null;
  if (window.__SNEEK_NATIVE_CONTEXT__) return window.__SNEEK_NATIVE_CONTEXT__ ?? null;

  try {
    const raw = window.localStorage.getItem("sneek-native-context");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NativeContextPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function isExpoPushToken(token: string | null | undefined) {
  if (!token) return false;
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim());
}

export function NativeDevicePushRegistration() {
  const { status } = useSession();
  const [nativeContext, setNativeContext] = useState<NativeContextPayload | null>(null);
  const lastRegisteredKeyRef = useRef<string>("");

  useEffect(() => {
    setNativeContext(readNativeContext());

    const handleContextEvent = (event: Event) => {
      const customEvent = event as CustomEvent<NativeContextPayload>;
      if (customEvent.detail && typeof customEvent.detail === "object") {
        setNativeContext(customEvent.detail);
      } else {
        setNativeContext(readNativeContext());
      }
    };

    window.addEventListener("sneek-native-context", handleContextEvent as EventListener);
    return () => {
      window.removeEventListener("sneek-native-context", handleContextEvent as EventListener);
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    const token = nativeContext?.expoPushToken?.trim() || "";
    if (!isExpoPushToken(token)) return;

    const platform = nativeContext?.platform?.trim() || "unknown";
    const appVersion = nativeContext?.appVersion?.trim() || "";
    const registrationKey = `${token}|${platform}|${appVersion}`;
    if (lastRegisteredKeyRef.current === registrationKey) return;

    let cancelled = false;

    async function register() {
      const res = await fetch("/api/me/mobile-push-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          platform,
          appVersion: appVersion || undefined,
        }),
      });

      if (cancelled || !res.ok) return;
      lastRegisteredKeyRef.current = registrationKey;
    }

    register().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [nativeContext?.appVersion, nativeContext?.expoPushToken, nativeContext?.platform, status]);

  return null;
}
