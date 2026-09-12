import { EBadge } from "@/components/v2/ui/primitives";
import { summarizeTiming, type TimingInput } from "@/lib/jobs/timing-summary";

export function CleanerTimingSummary({ showPlanned = true, showConstraints = true, ...input }: TimingInput & { showPlanned?: boolean; showConstraints?: boolean }) {
  const timing = summarizeTiming(input);
  if (!timing.plannedStart && !timing.plannedFinish && !timing.earliestAccess && !timing.arrival && !timing.warnings.length) return null;
  return <div className="w-full space-y-1.5 text-xs [overflow-wrap:anywhere]">
    {showPlanned && (timing.plannedStart || timing.plannedFinish) ? <div className="flex flex-wrap gap-x-3 gap-y-1 text-[hsl(var(--e-muted-foreground))]">
      <span>Planned start: {timing.plannedStart ?? "Not set"}</span><span>Planned finish: {timing.plannedFinish ?? "Not set"}</span>
    </div> : null}
    {showConstraints ? <div className="flex flex-wrap gap-2 empty:hidden">
      {timing.earliestAccess ? <EBadge tone="danger" soft>Late checkout: Start after {timing.earliestAccess}</EBadge> : null}
      {timing.arrival ? <EBadge tone="warning" soft>{timing.arrival.early ? "Early check-in" : "Same-day check-in"}: {timing.guestDeadline ? `Ready by ${timing.guestDeadline}` : "Arrival time not confirmed"}</EBadge> : null}
    </div> : null}
    {timing.warnings.length ? <div role="note" className="border-l-2 border-[hsl(var(--e-danger))] pl-2 text-[hsl(var(--e-danger))]">
      {timing.warnings.map(warning => <p key={warning}>{warning}</p>)}
      <p>Confirm timing with the admin team before proceeding.</p>
    </div> : null}
  </div>;
}
