"use client";

/**
 * Small shared pieces for the onboarding list and workspace (board "Property
 * onboarding"): checklist marks, the readiness bar, the save chip, labelled
 * fields that save when you leave them, and timezone-aware time labels.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { EField, E_INPUT_CLASS } from "@/components/v2/admin/estate-kit";
import type { SectionMark } from "@/lib/onboarding/workspace/readiness";

export const ONB_INPUT_CLASS = cn(E_INPUT_CLASS, "max-sm:h-11 max-sm:text-base");
/** The input class with width or other overrides merged (later classes win). */
export function onbInput(extra: string): string {
  return cn(ONB_INPUT_CLASS, extra);
}

export const ONB_MUTED = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";

/** "Today 14:06", "Wed 11 Nov 19:40": history instants in the organisation's timezone. */
export function formatSavedAt(iso: string | null, timeZone: string, now: Date = new Date()): string {
  if (!iso) return "Not saved yet";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  const sameDay = formatInTimeZone(date, timeZone, "yyyy-MM-dd") === formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  return sameDay ? `Today ${formatInTimeZone(date, timeZone, "HH:mm")}` : formatInTimeZone(date, timeZone, "EEE d MMM HH:mm");
}

export function formatClock(iso: string, timeZone: string): string {
  return formatInTimeZone(new Date(iso), timeZone, "HH:mm");
}

export function formatDay(iso: string, timeZone: string): string {
  return formatInTimeZone(new Date(iso), timeZone, "EEE d MMM");
}

const MARK_LABEL: Record<SectionMark, string> = { done: "Done", required: "Required, missing", recommended: "Recommended", client: "Client asked to fill" };

/** The round mark before a checklist line. The state is also written in words for screen readers. */
export function ChecklistMark({ mark, className }: { mark: SectionMark; className?: string }) {
  const tone =
    mark === "done"
      ? "bg-[hsl(var(--e-band-good-bg))] text-[hsl(var(--e-band-good-fg))]"
      : mark === "required"
        ? "bg-[hsl(var(--e-band-problem-bg))] text-[hsl(var(--e-band-problem-fg))]"
        : mark === "client"
          ? "bg-[hsl(var(--e-band-info-bg))] text-[hsl(var(--e-band-info-fg))]"
          : "border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))]";
  return (
    <span className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-[700]", tone, className)}>
      {mark === "done" ? <Check className="h-3.5 w-3.5" aria-hidden /> : mark === "required" ? "!" : mark === "client" ? "C" : "○"}
      <span className="sr-only">{MARK_LABEL[mark]}</span>
    </span>
  );
}

export function ReadinessBar({ percent, className, label }: { percent: number; className?: string; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--e-muted))]", className)}
    >
      <div className="h-full rounded-full bg-[hsl(var(--e-primary))]" style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** A text field that keeps what is typed and saves when the person leaves it (or presses Enter). */
export function AutoTextField({
  label,
  hint,
  value,
  onChange,
  onCommit,
  multiline = false,
  type = "text",
  placeholder,
  className,
  inputMode,
  disabled,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  multiline?: boolean;
  type?: string;
  placeholder?: string;
  className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  disabled?: boolean;
}) {
  return (
    <EField label={label} hint={hint} className={className}>
      {multiline ? (
        <textarea
          className={cn(ONB_INPUT_CLASS, "h-auto min-h-[4.5rem] py-2")}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
        />
      ) : (
        <input
          className={ONB_INPUT_CLASS}
          type={type}
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommit();
          }}
        />
      )}
    </EField>
  );
}

/** Text in a number field → a number, or null when empty or not a number (never zero by default). */
export function parseNumberInput(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function numberText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function PillToggle({ pressed, onClick, children, disabled }: { pressed: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-[var(--e-radius-pill)] border px-3 text-[0.8125rem] transition-colors max-sm:min-h-11",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
        pressed
          ? "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))]"
          : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]",
      )}
    >
      {children}
    </button>
  );
}

export function newLocalId(prefix: string): string {
  const cryptoApi = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  const random = cryptoApi && typeof cryptoApi.randomUUID === "function" ? cryptoApi.randomUUID().replace(/-/g, "").slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${random}`;
}
