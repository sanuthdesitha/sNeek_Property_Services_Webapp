"use client";

/**
 * Honest connection state for the visit screen. The visit buttons send
 * straight to the server and nothing is queued on the phone, so offline the
 * notice says nothing will send, rather than "saved on this phone".
 */
import * as React from "react";
import { WifiOff } from "lucide-react";

function subscribeToConnection(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return React.useSyncExternalStore(
    subscribeToConnection,
    () => navigator.onLine,
    // Server render: assume online; the client corrects it after hydration.
    () => true,
  );
}

export function OfflineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem] font-[550]">
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      No signal. Nothing is sent and the job does not close for the office until you are back online and press the button again.
    </p>
  );
}
