import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as LocalAuthentication from "expo-local-authentication";
import {
  DEFAULT_LOCK_DELAY_SECONDS,
  getLockDelaySeconds,
  getLockEnabled,
  LOCK_DELAY_OPTIONS,
  setLockDelaySeconds,
  setLockEnabled,
} from "@/lib/lock";

const BRAND = "#0f5a44";
const ACCENT = "#f59e0b";

/**
 * Native "App lock" settings: turn the biometric lock on/off and pick how long
 * the app can sit in the background before it re-locks. Persists to storage;
 * the caller refreshes the lock state on close.
 */
export function LockSettings({ onClose }: { onClose: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [delay, setDelay] = useState(DEFAULT_LOCK_DELAY_SECONDS);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [e, d] = await Promise.all([getLockEnabled(), getLockDelaySeconds()]);
      if (cancelled) return;
      setEnabled(e);
      setDelay(d);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle(next: boolean) {
    setNote(null);
    if (next) {
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) {
        setNote(
          "No fingerprint or Face ID is set up on this device. Add one in your phone settings first."
        );
        return;
      }
    }
    setEnabled(next);
    await setLockEnabled(next);
  }

  async function handlePickDelay(seconds: number) {
    setDelay(seconds);
    await setLockDelaySeconds(seconds);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>App lock</Text>
        <Text style={styles.subtitle}>
          Protect sNeek Ops with your fingerprint or Face ID.
        </Text>

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Require Face ID / fingerprint</Text>
            <Text style={styles.rowHint}>Ask to unlock when you open the app.</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={(v) => void handleToggle(v)}
            trackColor={{ false: "#cdd8d3", true: BRAND }}
            thumbColor="#ffffff"
          />
        </View>

        {note ? <Text style={styles.note}>{note}</Text> : null}

        <Text style={[styles.sectionLabel, !enabled && styles.disabled]}>
          Re-lock the app
        </Text>
        <Text style={[styles.rowHint, !enabled && styles.disabled]}>
          How long the app can stay in the background before asking again. A
          longer delay means quick app-switches won’t interrupt you.
        </Text>

        <View style={styles.options}>
          {LOCK_DELAY_OPTIONS.map((opt) => {
            const active = enabled && delay === opt.seconds;
            return (
              <Pressable
                key={opt.seconds}
                disabled={!enabled}
                onPress={() => void handlePickDelay(opt.seconds)}
                style={[
                  styles.option,
                  active && styles.optionActive,
                  !enabled && styles.optionDisabled,
                ]}
              >
                <Text style={[styles.optionText, active && styles.optionTextActive]}>
                  {opt.label}
                </Text>
                {active ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>

        <Pressable style={styles.doneBtn} onPress={onClose}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { ...StyleSheet.absoluteFillObject, backgroundColor: "#ffffff", zIndex: 60 },
  content: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: "800", color: "#10322a" },
  subtitle: { fontSize: 14, color: "#5a6b64", marginTop: 6, lineHeight: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 26,
    gap: 14,
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: "700", color: "#1b3a31" },
  rowHint: { fontSize: 13, color: "#6b7c75", marginTop: 3, lineHeight: 18 },
  note: { color: "#a15c00", fontSize: 13, marginTop: 12, lineHeight: 18 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#33433d",
    marginTop: 30,
  },
  disabled: { opacity: 0.45 },
  options: { marginTop: 14, gap: 10 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderColor: "#dce6e1",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionActive: { borderColor: BRAND, backgroundColor: "rgba(15,90,68,0.06)" },
  optionDisabled: { opacity: 0.45 },
  optionText: { fontSize: 15, color: "#243f37", fontWeight: "600" },
  optionTextActive: { color: BRAND, fontWeight: "800" },
  check: { color: BRAND, fontSize: 18, fontWeight: "800" },
  doneBtn: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 34,
  },
  doneText: { color: "#1a1206", fontSize: 16, fontWeight: "800" },
});
