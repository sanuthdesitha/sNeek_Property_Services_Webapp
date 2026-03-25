import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WebAppShell } from "@/components/WebAppShell";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export default function App() {
  const notifications = usePushNotifications();

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <WebAppShell notifications={notifications} />
    </SafeAreaProvider>
  );
}
