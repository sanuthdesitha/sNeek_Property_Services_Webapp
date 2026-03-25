"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TextHistorySuggestions } from "@/components/shared/text-history-suggestions";
import { GlobalRequestProgress } from "@/components/shared/global-request-progress";
import { ReturnSync } from "@/components/shared/return-sync";
import { LiveNotifications } from "@/components/shared/live-notifications";
import { NativeDevicePushRegistration } from "@/components/shared/native-device-push-registration";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000 } },
  }));
  const [hardRefreshKey, setHardRefreshKey] = useState(0);

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ReturnSync onHardSync={() => setHardRefreshKey((current) => current + 1)} />
        <div key={hardRefreshKey}>{children}</div>
        <GlobalRequestProgress />
        <LiveNotifications />
        <NativeDevicePushRegistration />
        <TextHistorySuggestions />
        <Toaster />
      </QueryClientProvider>
    </SessionProvider>
  );
}
