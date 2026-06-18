import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBiometricLock } from "@/hooks/useBiometricLock";

const BRAND = "#0f5a44";

/**
 * Gates the app behind the device biometric lock. Renders `children` only once
 * unlocked (or when the device has no biometrics enrolled). While locked it
 * shows a branded lock screen with an Unlock button.
 */
export function BiometricGate({ children }: { children: ReactNode }) {
  const { available, locked, checking, authenticate } = useBiometricLock();

  // No biometrics enrolled, or already unlocked → show the app.
  if (!available || (!locked && !checking)) {
    return <>{children}</>;
  }

  return (
    <View style={styles.fill}>
      <View style={styles.lockBadge}>
        <Text style={styles.lockGlyph}>🔒</Text>
      </View>
      <Text style={styles.title}>sNeek is locked</Text>
      <Text style={styles.subtitle}>Unlock with your fingerprint or Face ID to continue.</Text>
      <Pressable style={styles.button} onPress={() => void authenticate()}>
        <Text style={styles.buttonText}>Unlock</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
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
  subtitle: { color: "rgba(255,255,255,0.82)", fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 28 },
  button: { backgroundColor: "#f59e0b", paddingHorizontal: 34, paddingVertical: 14, borderRadius: 12 },
  buttonText: { color: "#1a1206", fontSize: 16, fontWeight: "700" },
});
