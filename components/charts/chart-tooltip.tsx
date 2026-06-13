"use client";

import * as React from "react";

/**
 * Shared glassy tooltip for all Recharts surfaces. Matches the Sphere-UI
 * surface tokens (works in light + dark automatically).
 */
export function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>;
  label?: string | number;
  valueFormatter?: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-popover/95 px-3 py-2 text-xs shadow-md backdrop-blur">
      {label != null ? (
        <p className="mb-1 font-semibold text-foreground">{String(label)}</p>
      ) : null}
      <div className="space-y-0.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
              {entry.name ?? entry.dataKey}
            </span>
            <span className="font-semibold tabular-nums text-foreground">
              {typeof entry.value === "number" && valueFormatter
                ? valueFormatter(entry.value)
                : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
