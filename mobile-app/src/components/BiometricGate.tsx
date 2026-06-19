import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBiometricLock } from "@/hooks/useBiometricLock";
import { LockSettings } from "@/components/LockSettings";

const BRAND = "#0f5a44";

/**
 * Gates the app behind the device biometric lock. The app (`children`) stays
 * MOUNTED at all times — when locked we overlay an opaque lock screen on top
 * instead of unmounting, so unlocking returns you exactly where you were (no
 * reload, no lost typing). The lock screen also opens "App lock settings"
 * (after a successful unlock) to change the lock + re-lock delay.
 */
export function BiometricGate({ children }: { children: ReactNode }) {
  const { available, locked, checking, authenticate, refresh } = useBiometricLock();
  const [showSettings, setShowSettings] = useState(false);
  const wantSettingsRef = useRef(false);

  // When the user taps "App lock settings" on the lock screen we authenticate
  // first; opening settings only after a successful unlock keeps someone from
  // disabling the lock without authorization.
  useEffect(() => {
    if (!locked && wantSettingsRef.current) {
      wantSettingsRef.current = false;
      setShowSettings(true);
    }
  }, [locked]);

  const showLock = available && locked && !checking;

  return (
    <View style={styles.fill}>
      {children}

      {showLock ? (
        <View style={styles.lockOverlay}>
          <View style={styles.lockBadge}>
            <Text style={styles.lockGlyph}>🔒</Text>
          </View>
          <Text style={styles.title}>sNeek Ops is locked</Text>
          <Text style={styles.subtitle}>
            Unlock with your fingerprint or Face ID to continue.
          </Text>
          <Pressable style={styles.button} onPress={() => void authenticate()}>
            <Text style={styles.buttonText}>Unlock</Text>
          </Pressable>
          <Pressable
            style={styles.settingsLink}
            onPress={() => {
              wantSettingsRef.current = true;
              void authenticate();
            }}
          >
            <Text style={styles.settingsLinkText}>App lock settings</Text>
          </Pressable>
        </View>
      ) : null}

      {showSettings ? (
        <LockSettings
          onClose={() => {
            setShowSettings(false);
            void refresh();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    zIndex: 40,
  },
  lockBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  lockGlyph: { fontSize: 40 },
  title: { color: "#ffffff", fontSize: 22, fontWeight: "800", marginBottom: 8 },
  subtitle: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 28,
  },
  button: {
    backgroundColor: "#f59e0b",
    paddingHorizontal: 34,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: { color: "#1a1206", fontSize: 16, fontWeight: "700" },
  settingsLink: { marginTop: 18, paddingVertical: 8 },
  settingsLinkText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
