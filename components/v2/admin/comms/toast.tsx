"use client";

/**
 * Minimal Estate-scoped toast used by the v2 admin marketing + comms
 * workspaces. No dependency on @/hooks/use-toast or components/ui/*.
 */
import * as React from "react";

export type EstateToast = { title: string; description?: string; tone: "success" | "danger" };

export function useEstateToast() {
  const [toast, setToast] = React.useState<EstateToast | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = React.useCallback((next: EstateToast) => {
    setToast(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { toast, push };
}

export function EToastViewport({ toast }: { toast: EstateToast | null }) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] w-full max-w-sm">
      <div
        className="e-rise pointer-events-auto rounded-[var(--e-radius-lg)] border-l-[3px] p-4 shadow-[var(--e-elevation-3)]"
        style={{
          backgroundColor: toast.tone === "danger" ? "hsl(var(--e-danger-soft))" : "hsl(var(--e-success-soft))",
          borderColor: toast.tone === "danger" ? "hsl(var(--e-danger))" : "hsl(var(--e-success))",
        }}
        role="status"
      >
        <p className="text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{toast.description}</p>
        ) : null}
      </div>
    </div>
  );
}
