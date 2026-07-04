"use client";

import * as React from "react";

/**
 * Per-kind "use v2" flag toggle (rebrand doc 03 §5.3). Only meaningful once a
 * kind has a published doc — flipping on routes that kind's live render through
 * the v2 engine; off is instant rollback to the legacy renderer.
 */
export function FlagToggle({
  kind,
  initialEnabled,
  disabled,
}: {
  kind: string;
  initialEnabled: boolean;
  disabled?: boolean;
}) {
  const [enabled, setEnabled] = React.useState(initialEnabled);
  const [busy, setBusy] = React.useState(false);

  const toggle = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy || disabled) return;
    const next = !enabled;
    setBusy(true);
    setEnabled(next); // optimistic
    try {
      const res = await fetch("/api/admin/template-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, enabled: next }),
      });
      if (!res.ok) setEnabled(!next); // revert on failure
    } catch {
      setEnabled(!next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || busy}
      title={disabled ? "Publish a version first" : enabled ? "Live: v2 renderer" : "Live: legacy renderer"}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        disabled
          ? "cursor-not-allowed bg-slate-100 text-slate-400"
          : enabled
            ? "bg-emerald-600 text-white"
            : "bg-slate-200 text-slate-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${enabled && !disabled ? "bg-white" : "bg-slate-400"}`} />
      {enabled && !disabled ? "v2 live" : "legacy"}
    </button>
  );
}
