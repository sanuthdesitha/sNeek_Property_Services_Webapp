import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";

export type BiometricLock = {
  /** Biometric (or device passcode) is available + enrolled on this device. */
  available: boolean;
  /** True while we still need a successful unlock before showing the app. */
  locked: boolean;
  /** Still resolving whether biometrics are available. */
  checking: boolean;
  /** Trigger the OS biometric / passcode prompt. */
  authenticate: () => Promise<void>;
};

/**
 * Fingerprint / Face ID lock for the app.
 *  - On launch, if the device has enrolled biometrics (or a passcode), the app
 *    starts locked and prompts to unlock.
 *  - Re-locks whenever the app returns to the foreground from the background, so
 *    a backgrounded session can't be resumed without authenticating.
 *  - Devices with NO biometrics/passcode are never locked out (available=false).
 */
export function useBiometricLock(): BiometricLock {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [locked, setLocked] = useState(true);
  const authingRef = useRef(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const authenticate = useCallback(async () => {
    if (authingRef.current) return;
    authingRef.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock sNeek",
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

  // Resolve capability once, then auto-prompt if we should lock.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [hasHardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        const can = hasHardware && enrolled;
        if (cancelled) return;
        setAvailable(can);
        setLocked(can);
        setChecking(false);
        if (can) void authenticate();
      } catch {
        if (cancelled) return;
        setAvailable(false);
        setLocked(false);
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticate]);

  // Re-lock + re-prompt when returning to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;
      if (available && prev.match(/inactive|background/) && next === "active") {
        setLocked(true);
        void authenticate();
      }
    });
    return () => sub.remove();
  }, [available, authenticate]);

  return { available, locked, checking, authenticate };
}
