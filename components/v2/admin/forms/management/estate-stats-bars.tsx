/**
 * ESTATE — native stats bar primitives (server-renderable, div-based).
 * Substitutes for @/components/charts on the v2 forms stats page: no chart libs,
 * just Estate-token-styled bars. All pure presentational components.
 */
import * as React from "react";
import { ECard } from "@/components/v2/ui/primitives";

/** Thin intensity bar (row-level fill). */
export function EBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-muted))]">
      <div
        className="h-full rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-gold))]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Vertical column chart (weekly volume) rendered with flex + divs. */
export function EColumnChart({
  data,
  title,
  subtitle,
}: {
  data: Array<{ label: string; count: number }>;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <ECard className="p-5">
      <div className="mb-4">
        <h3 className="text-[1rem] font-semibold tracking-[-0.01em] text-[hsl(var(--e-foreground))]">
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex h-40 items-end gap-1.5">
        {data.map((d, i) => {
          const h = d.count > 0 ? Math.max(4, Math.round((d.count / max) * 100)) : 1.5;
          return (
            <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1.5">
              <span className="e-tnum text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                {d.count > 0 ? d.count : ""}
              </span>
              <div
                className="w-full rounded-t-[var(--e-radius-sm)] bg-[hsl(var(--e-gold))] transition-[height]"
                style={{ height: `${h}%` }}
                title={`${d.label}: ${d.count}`}
              />
              <span className="w-full truncate text-center text-[0.625rem] text-[hsl(var(--e-text-faint))]">
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
    </ECard>
  );
}

/** Horizontal labelled bar list (per-field completion). */
export function EBarList({
  data,
  title,
  subtitle,
}: {
  data: Array<{ label: string; completion: number }>;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <ECard className="p-5">
      <div className="mb-4">
        <h3 className="text-[1rem] font-semibold tracking-[-0.01em] text-[hsl(var(--e-foreground))]">
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{subtitle}</p>
        ) : null}
      </div>
      {data.length === 0 ? (
        <p className="py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          No field data yet.
        </p>
      ) : (
        <div className="space-y-2.5">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-3">
              <span
                className="w-40 shrink-0 truncate text-[0.8125rem] text-[hsl(var(--e-text-secondary))]"
                title={d.label}
              >
                {d.label}
              </span>
              <EBar value={d.completion} max={100} />
              <span className="e-tnum w-10 shrink-0 text-right text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {d.completion}%
              </span>
            </div>
          ))}
        </div>
      )}
    </ECard>
  );
}
