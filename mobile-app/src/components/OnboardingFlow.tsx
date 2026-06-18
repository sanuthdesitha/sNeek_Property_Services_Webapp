import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as LocalAuthentication from "expo-local-authentication";
import { requestAllPermissions, type PermissionResults } from "@/lib/permissions";
import { setFlag, STORAGE_KEYS } from "@/lib/storage";

const BRAND = "#0f5a44";
const ACCENT = "#f59e0b";

type StepKind = "info" | "permissions" | "security";

type Step = {
  kind: StepKind;
  glyph: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    kind: "info",
    glyph: "✨",
    title: "Welcome to sNeek",
    body: "Your full property-services workspace — jobs, QA, laundry, inventory and reports — now in your pocket.",
  },
  {
    kind: "info",
    glyph: "📸",
    title: "Capture evidence on site",
    body: "Open a job and tap “Take photo” to capture guided evidence. Live captures get a GPS + time stamp; photos you upload from your gallery keep their own.",
  },
  {
    kind: "info",
    glyph: "🧭",
    title: "Track everything live",
    body: "Check in, run your checklist, log maintenance and complete QA. Managers see live progress and locations as you work.",
  },
  {
    kind: "permissions",
    glyph: "🔐",
    title: "Allow a few permissions",
    body: "sNeek needs these so jobs, evidence and alerts work properly. You can change them later in your phone settings.",
  },
  {
    kind: "security",
    glyph: "🛡️",
    title: "Lock the app with Face ID",
    body: "Add a fingerprint / Face ID lock so only you can open sNeek on this device. Recommended.",
  },
];

const PERMISSION_LABELS: Record<keyof PermissionResults, string> = {
  notifications: "Notifications — job alerts & messages",
  location: "Location — on-site check-ins & GPS stamps",
  media: "Photos & files — attach and upload evidence",
};

export function OnboardingFlow({ onFinish }: { onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [permissions, setPermissions] = useState<PermissionResults | null>(null);
  const [requestingPerms, setRequestingPerms] = useState(false);
  const [biometricChoice, setBiometricChoice] = useState<"pending" | "enabled" | "skipped">(
    "pending"
  );
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricNote, setBiometricNote] = useState<string | null>(null);

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const progress = useMemo(
    () => Array.from({ length: STEPS.length }, (_, i) => i <= index),
    [index]
  );

  // Animate each step in (fade + rise).
  useEffect(() => {
    fade.setValue(0);
    slide.setValue(20);
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, fade, slide]);

  function goNext() {
    if (isLast) {
      onFinish();
      return;
    }
    setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  async function handleAllowPermissions() {
    setRequestingPerms(true);
    try {
      const result = await requestAllPermissions();
      setPermissions(result);
    } finally {
      setRequestingPerms(false);
    }
  }

  async function handleEnableBiometric() {
    setBiometricBusy(true);
    setBiometricNote(null);
    try {
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) {
        setBiometricNote(
          "No fingerprint or Face ID is set up on this device. Add one in your phone settings to use the app lock."
        );
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm to turn on the sNeek app lock",
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
        cancelLabel: "Cancel",
      });
      if (result.success) {
        await setFlag(STORAGE_KEYS.biometricEnabled, true);
        setBiometricChoice("enabled");
      } else {
        setBiometricNote("Couldn’t confirm — you can turn this on later.");
      }
    } catch {
      setBiometricNote("Couldn’t enable the lock — you can turn this on later.");
    } finally {
      setBiometricBusy(false);
    }
  }

  function handleSkipBiometric() {
    void setFlag(STORAGE_KEYS.biometricEnabled, false);
    setBiometricChoice("skipped");
  }

  // The primary button is disabled until the active action step is resolved.
  const primaryDisabled =
    (step.kind === "permissions" && permissions === null) ||
    (step.kind === "security" && biometricChoice === "pending");

  const primaryLabel = isLast ? "Get started" : "Continue";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.root}>
        {/* progress dots */}
        <View style={styles.dots}>
          {progress.map((on, i) => (
            <View key={i} style={[styles.dot, on ? styles.dotOn : null]} />
          ))}
        </View>

        <Animated.View
          style={[
            styles.body,
            { opacity: fade, transform: [{ translateY: slide }] },
          ]}
        >
          <View style={styles.glyphBadge}>
            <Text style={styles.glyph}>{step.glyph}</Text>
          </View>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.text}>{step.body}</Text>

          {step.kind === "permissions" ? (
            <View style={styles.panel}>
              {(Object.keys(PERMISSION_LABELS) as Array<keyof PermissionResults>).map(
                (key) => {
                  const status = permissions?.[key];
                  const mark =
                    status === "granted" ? "✓" : status ? "—" : "•";
                  return (
                    <View key={key} style={styles.permRow}>
                      <Text
                        style={[
                          styles.permMark,
                          status === "granted" ? styles.permMarkOk : null,
                        ]}
                      >
                        {mark}
                      </Text>
                      <Text style={styles.permLabel}>{PERMISSION_LABELS[key]}</Text>
                    </View>
                  );
                }
              )}
              {permissions === null ? (
                <Pressable
                  style={[styles.secondaryBtn, requestingPerms && styles.btnBusy]}
                  disabled={requestingPerms}
                  onPress={() => void handleAllowPermissions()}
                >
                  <Text style={styles.secondaryBtnText}>
                    {requestingPerms ? "Requesting…" : "Allow access"}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.hint}>
                  All set — you can adjust these anytime in phone settings.
                </Text>
              )}
            </View>
          ) : null}

          {step.kind === "security" ? (
            <View style={styles.panel}>
              {biometricChoice === "enabled" ? (
                <Text style={[styles.hint, styles.hintOk]}>
                  ✓ App lock is on. You’ll unlock with Face ID / fingerprint.
                </Text>
              ) : biometricChoice === "skipped" ? (
                <Text style={styles.hint}>
                  No lock for now — you can enable it later.
                </Text>
              ) : (
                <>
                  <Pressable
                    style={[styles.secondaryBtn, biometricBusy && styles.btnBusy]}
                    disabled={biometricBusy}
                    onPress={() => void handleEnableBiometric()}
                  >
                    <Text style={styles.secondaryBtnText}>
                      {biometricBusy ? "Confirming…" : "Turn on app lock"}
                    </Text>
                  </Pressable>
                  <Pressable style={styles.skipBtn} onPress={handleSkipBiometric}>
                    <Text style={styles.skipText}>Not now</Text>
                  </Pressable>
                </>
              )}
              {biometricNote ? <Text style={styles.note}>{biometricNote}</Text> : null}
            </View>
          ) : null}
        </Animated.View>

        <Pressable
          style={[styles.primaryBtn, primaryDisabled && styles.primaryBtnDisabled]}
          disabled={primaryDisabled}
          onPress={goNext}
        >
          <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffff" },
  root: { flex: 1, paddingHorizontal: 28, paddingTop: 12, paddingBottom: 24 },
  dots: { flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 8 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#d7e3dd",
  },
  dotOn: { backgroundColor: BRAND, width: 22 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  glyphBadge: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: "rgba(15,90,68,0.08)",
    borderWidth: 2,
    borderColor: "rgba(15,90,68,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  glyph: { fontSize: 48 },
  title: {
    color: "#10322a",
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
  },
  text: {
    color: "#4a5b54",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 6,
    paddingHorizontal: 4,
  },
  panel: {
    width: "100%",
    marginTop: 22,
    gap: 12,
    alignItems: "stretch",
  },
  permRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  permMark: {
    width: 24,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "800",
    color: "#9aa8a2",
  },
  permMarkOk: { color: BRAND },
  permLabel: { flex: 1, color: "#33433d", fontSize: 14, lineHeight: 19 },
  secondaryBtn: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 6,
  },
  btnBusy: { opacity: 0.7 },
  secondaryBtnText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  skipBtn: { alignItems: "center", paddingVertical: 8 },
  skipText: { color: "#6b7c75", fontSize: 14, fontWeight: "600" },
  hint: { color: "#4a5b54", fontSize: 13, textAlign: "center", lineHeight: 19 },
  hintOk: { color: BRAND, fontWeight: "700" },
  note: { color: "#a15c00", fontSize: 13, textAlign: "center", lineHeight: 18 },
  primaryBtn: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryBtnDisabled: { backgroundColor: "#e4d9bf" },
  primaryBtnText: { color: "#1a1206", fontSize: 16, fontWeight: "800" },
});
