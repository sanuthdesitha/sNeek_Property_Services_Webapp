"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TextHistorySuggestions } from "@/components/shared/text-history-suggestions";
import { GlobalRequestProgress } from "@/components/shared/global-request-progress";
import { ReturnSync } from "@/components/shared/return-sync";
import { LiveNotifications } from "@/components/shared/live-notifications";
import { NativeDevicePushRegistration } from "@/components/shared/native-device-push-registration";
import { AppInstallPrompt } from "@/components/shared/app-install-prompt";
import { useEffect, useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000 } },
  }));
  const [hardRefreshKey, setHardRefreshKey] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isLocalDevHost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isLocalDevHost) return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    async function resetLocalServiceWorkerCache() {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const cacheKeys = typeof caches !== "undefined" ? await caches.keys() : [];
      const hasServiceWorkerArtifacts =
        registrations.length > 0 ||
        cacheKeys.some(
          (key) =>
            key.startsWith("workbox-") ||
            key.includes("precache") ||
            key.includes("runtime")
        );

      if (!hasServiceWorkerArtifacts) return;

      await Promise.all(registrations.map((registration) => registration.unregister()));
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));

      if (cancelled) return;

      const reloadKey = "__sneek_local_sw_reset__";
      if (sessionStorage.getItem(reloadKey) !== "1") {
        sessionStorage.setItem(reloadKey, "1");
        window.location.reload();
      }
    }

    resetLocalServiceWorkerCache().catch(() => {
      // Ignore local cache reset failures; the app still renders normally.
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ReturnSync onHardSync={() => setHardRefreshKey((current) => current + 1)} />
        <div key={hardRefreshKey}>{children}</div>
        <GlobalRequestProgress />
        <LiveNotifications />
        <NativeDevicePushRegistration />
        <AppInstallPrompt />
        <TextHistorySuggestions />
        <Toaster />
      </QueryClientProvider>
    </SessionProvider>
  );
}
