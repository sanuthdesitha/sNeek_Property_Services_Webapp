import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WebAppShell } from "@/components/WebAppShell";
import { AnimatedSplash } from "@/components/AnimatedSplash";
import { BiometricGate } from "@/components/BiometricGate";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useOnboarding } from "@/hooks/useOnboarding";

export default function App() {
  const notifications = usePushNotifications();
  const onboarding = useOnboarding();
  const [splashDone, setSplashDone] = useState(false);

  // First launch: run the animated walkthrough (permissions + app lock) before
  // the biometric gate / web app mount. After it's completed once, this is
  // skipped on every future launch.
  const showOnboarding = !onboarding.checking && onboarding.needsOnboarding;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {showOnboarding ? (
        <OnboardingFlow onFinish={() => void onboarding.complete()} />
      ) : (
        // Biometric lock wraps the app; the WebView only mounts once unlocked.
        <BiometricGate>
          <WebAppShell notifications={notifications} />
        </BiometricGate>
      )}
      {/* Logo open-animation overlays everything until it finishes. */}
      {!splashDone ? <AnimatedSplash onFinish={() => setSplashDone(true)} /> : null}
    </SafeAreaProvider>
  );
}
