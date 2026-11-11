"use client";

/**
 * Loading, failure, empty and legend pieces, kept apart so a failed read is
 * never drawn as an empty calendar.
 */
import { EButton } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";

export function CalendarLoading() {
  return <p role="status" className="px-6 py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading the calendar…</p>;
}

export function CalendarError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="px-6 py-12 text-center">
      <p role="alert" className="mb-4 text-[0.875rem]">{message || "The calendar could not be loaded."} Nothing is shown until it loads.</p>
      <EButton variant="outline" onClick={onRetry}>Retry</EButton>
    </div>
  );
}

const LEGEND: Array<{ label: string; className: string }> = [
  { label: "Done ✓", className: "border-[hsl(var(--e-success)/0.3)] bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-success))]" },
  { label: "On site", className: "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]" },
  { label: "Late", className: "border-[hsl(var(--e-warning)/0.35)] bg-[hsl(var(--e-warning-soft))] text-[hsl(var(--e-warning))]" },
  { label: "Offered", className: "border-[hsl(var(--e-info)/0.3)] bg-[hsl(var(--e-info-soft))] text-[hsl(var(--e-info))]" },
  { label: "Planned", className: "border-[hsl(var(--e-info)/0.3)] bg-[hsl(var(--e-info-soft))] text-[hsl(var(--e-info))]" },
  { label: "No cleaner", className: "border-dashed border-[hsl(var(--e-danger))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-danger))]" },
  { label: "Skipped", className: "border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))] text-[hsl(var(--e-muted-foreground))]" },
];

export function CalendarFootnote({ hoursBasis }: { hoursBasis: string }) {
  return (
    <div className="space-y-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
      <ul aria-label="Status key" className="flex flex-wrap gap-1.5">
        {LEGEND.map((item) => (
          <li key={item.label} className={cn("rounded-[6px] border px-1.5 py-0.5", item.className)}>{item.label}</li>
        ))}
      </ul>
      <p>{hoursBasis} &ldquo;Not rostered&rdquo; means the cleaner&rsquo;s saved availability has no hours that day; there is no leave record in the system.</p>
    </div>
  );
}
