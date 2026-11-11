"use client";

/**
 * The hub's one period control: 7 days / 30 days / 90 days / Custom. Custom
 * opens a small panel with inclusive from/to days; the draft survives closing
 * the panel and is only applied with "Apply". Days are Sydney calendar days.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";
import { LabeledField } from "./labeled-field";
import { periodLabel, type QualityPeriod } from "@/lib/quality/period";
import type { QualityPeriodKey } from "@/lib/quality/types";

const FIXED: Array<{ key: Exclude<QualityPeriodKey, "custom">; label: string }> = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

export type PeriodChoice = Pick<QualityPeriod, "key" | "fromKey" | "toKey">;

export function PeriodControl({
  period,
  onChange,
  disabled = false,
}: {
  period: QualityPeriod;
  onChange: (next: PeriodChoice) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(period.fromKey ?? "");
  const [to, setTo] = React.useState(period.toKey);
  const [problem, setProblem] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function apply() {
    if (!from || !to) {
      setProblem("Choose both days.");
      return;
    }
    if (from > to) {
      setProblem("The first day is after the last day.");
      return;
    }
    setProblem(null);
    setOpen(false);
    onChange({ key: "custom", fromKey: from, toKey: to });
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Period"
      className="relative flex flex-wrap items-center gap-1.5"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      {FIXED.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={period.key === option.key}
          disabled={disabled}
          onClick={() => onChange({ key: option.key, fromKey: null, toKey: period.toKey })}
          className={cn(E_CHIP_CLASS, period.key === option.key && E_CHIP_ON_CLASS)}
        >
          {option.label}
        </button>
      ))}
      <button
        ref={triggerRef}
        type="button"
        aria-pressed={period.key === "custom"}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={cn(E_CHIP_CLASS, period.key === "custom" && E_CHIP_ON_CLASS)}
      >
        {period.key === "custom" ? `Custom: ${periodLabel(period)}` : "Custom"}
      </button>
      <div
        id={panelId}
        role="group"
        aria-label="Custom period"
        hidden={!open}
        className="absolute right-0 top-full z-40 mt-1 w-[min(18rem,calc(100vw-2rem))] space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 shadow-[var(--e-elevation-3)]"
      >
        <LabeledField label="First day">
          <EInput type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
        </LabeledField>
        <LabeledField label="Last day">
          <EInput type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
        </LabeledField>
        {problem ? (
          <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">
            {problem}
          </p>
        ) : null}
        <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Both days are included, in Sydney time.</p>
        <EButton size="sm" onClick={apply}>
          Apply
        </EButton>
      </div>
    </div>
  );
}
