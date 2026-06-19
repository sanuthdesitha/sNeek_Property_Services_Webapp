import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFlag, setFlag, STORAGE_KEYS } from "@/lib/storage";

/** How long the app can sit in the background before it re-locks. */
export const LOCK_DELAY_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: "Immediately", seconds: 0 },
  { label: "After 30 seconds", seconds: 30 },
  { label: "After 1 minute", seconds: 60 },
  { label: "After 5 minutes", seconds: 300 },
  { label: "After 15 minutes", seconds: 900 },
];

export const DEFAULT_LOCK_DELAY_SECONDS = 60;

export async function getLockEnabled(): Promise<boolean> {
  return getFlag(STORAGE_KEYS.biometricEnabled);
}

export async function setLockEnabled(enabled: boolean): Promise<void> {
  return setFlag(STORAGE_KEYS.biometricEnabled, enabled);
}

export async function getLockDelaySeconds(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.lockDelay);
    if (raw == null) return DEFAULT_LOCK_DELAY_SECONDS;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LOCK_DELAY_SECONDS;
  } catch {
    return DEFAULT_LOCK_DELAY_SECONDS;
  }
}

export async function setLockDelaySeconds(seconds: number): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.lockDelay, String(Math.max(0, Math.round(seconds))));
  } catch {
    // best-effort
  }
}
