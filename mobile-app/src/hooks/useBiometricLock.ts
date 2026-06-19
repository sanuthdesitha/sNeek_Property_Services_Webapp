import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { getLockDelaySeconds, getLockEnabled } from "@/lib/lock";

export type BiometricLock = {
  /** Biometric lock is opted-in AND the device has enrolled biometrics/passcode. */
  available: boolean;
  /** True while we still need a successful unlock before showing the app. */
  locked: boolean;
  /** Still resolving capability + the opt-in preference. */
  checking: boolean;
  /** Trigger the OS biometric / passcode prompt. */
  authenticate: () => Promise<void>;
  /** Re-read the lock preference (call after changing it in settings). */
  refresh: () => Promise<void>;
};

async function computeAvailable(): Promise<boolean> {
  try {
    const [enabled, hasHardware, enrolled] = await Promise.all([
      getLockEnabled(),
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return enabled && hasHardware && enrolled;
  } catch {
    return false;
  }
}

/**
 * Fingerprint / Face ID lock for the app — OPT-IN with a configurable grace
 * period.
 *  - The lock engages only when the user enabled it AND the device has enrolled
 *    biometrics/passcode.
 *  - On a COLD start (enabled) the app locks and prompts immediately.
 *  - When returning from the background it only re-locks if the app was away
 *    longer than the user's chosen delay (default 1 min) — so quick app-switches
 *    don't interrupt you or wipe in-progress work.
 *  - The lock screen is overlaid on top of the live app (the WebView stays
 *    mounted), so unlocking returns you exactly where you were.
 */
export function useBiometricLock(): BiometricLock {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [locked, setLocked] = useState(true);
  const authingRef = useRef(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const backgroundedAt = useRef<number | null>(null);

  const authenticate = useCallback(async () => {
    if (authingRef.current) return;
    authingRef.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock sNeek Ops",
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
        cancelLabel: "Cancel",
      });
      if (result.success) setLocked(false);
    } catch {
      // leave locked; the lock screen shows a retry button
    } finally {
      authingRef.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    const can = await computeAvailable();
    setAvailable(can);
    if (!can) setLocked(false);
  }, []);

  // Cold start: resolve capability + opt-in, then prompt if we should lock.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const can = await computeAvailable();
      if (cancelled) return;
      setAvailable(can);
      setLocked(can);
      setChecking(false);
      if (can) void authenticate();
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticate]);

  // Background/foreground: stamp when we leave; on return, re-lock only if the
  // configured delay has elapsed.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;

      if (next === "background" || next === "inactive") {
        if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
        return;
      }

      if (next === "active" && prev.match(/inactive|background/)) {
        void (async () => {
          const can = await computeAvailable();
          setAvailable(can);
          if (!can) {
            setLocked(false);
            backgroundedAt.current = null;
            return;
          }
          const since = backgroundedAt.current;
          const delayMs = (await getLockDelaySeconds()) * 1000;
          backgroundedAt.current = null;
          if (since == null || Date.now() - since >= delayMs) {
            setLocked(true);
            void authenticate();
          }
        })();
      }
    });
    return () => sub.remove();
  }, [authenticate]);

  return { available, locked, checking, authenticate, refresh };
}
