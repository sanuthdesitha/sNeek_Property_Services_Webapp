import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WebAppShell } from "@/components/WebAppShell";
import { AnimatedSplash } from "@/components/AnimatedSplash";
import { BiometricGate } from "@/components/BiometricGate";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export default function App() {
  const notifications = usePushNotifications();
  const [splashDone, setSplashDone] = useState(false);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {/* Biometric lock wraps the app; the WebView only mounts once unlocked. */}
      <BiometricGate>
        <WebAppShell notifications={notifications} />
      </BiometricGate>
      {/* Logo open-animation overlays everything until it finishes. */}
      {!splashDone ? <AnimatedSplash onFinish={() => setSplashDone(true)} /> : null}
    </SafeAreaProvider>
  );
}
