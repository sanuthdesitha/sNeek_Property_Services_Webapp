import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Thin persisted-flag helpers on top of AsyncStorage. Used for one-time
 * onboarding state and the opt-in biometric-lock preference.
 */

export const STORAGE_KEYS = {
  onboardingComplete: "sneek.onboarding.complete.v1",
  biometricEnabled: "sneek.security.biometric.enabled.v1",
  lockDelay: "sneek.security.lock.delay.v1",
} as const;

export async function getFlag(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === "1";
  } catch {
    return false;
  }
}

export async function setFlag(key: string, value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value ? "1" : "0");
  } catch {
    // best-effort; a failed write just means we re-ask next launch
  }
}
