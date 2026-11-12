/**
 * Maintenance Today › "New for you" (board "Maintenance portal", screen 1).
 *
 * An assignment that has not been accepted, declined or completed, with the
 * offered price and the three answers the existing assignment route accepts:
 * Accept, Can't take it, Other price (MaintenanceAssignmentActions). Server
 * component; the caller loads the rows so a failed read stays visible.
 */
import { MapPin } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { EBadge, ECard, ECardBody } from "@/components/v2/ui/primitives";
import {
  MaintenanceAssignmentActions,
  type AssignmentActionState,
} from "@/components/v2/portal/maintenance-assignment-actions";
import { describePay, resolveAssignmentPay } from "@/lib/maintenance/instructions";

const TZ = "Australia/Sydney";

export interface NewAssignmentEntry {
  item: {
    id: string;
    title: string;
    description: string | null;
    area: string | null;
    scheduledFor: Date | null;
    property: { name: string | null; suburb: string | null } | null;
  };
  assignedAt: Date;
  assignment: AssignmentActionState;
}

/** Pending = offered and not yet answered. */
export function isNewAssignment(entry: { assignment: Pick<AssignmentActionState, "acceptedAt" | "declinedAt" | "completedAt"> }): boolean {
  return !entry.assignment.acceptedAt && !entry.assignment.declinedAt && !entry.assignment.completedAt;
}

export function NewAssignments({ entries }: { entries: readonly NewAssignmentEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="maintenance-new" className="space-y-3">
      <h2 id="maintenance-new" className="e-eyebrow">New for you</h2>
      {entries.map((entry) => {
        const pay = resolveAssignmentPay(entry.assignment);
        const place = [entry.item.property?.name, entry.item.property?.suburb].filter(Boolean).join(", ");
        const before = entry.item.scheduledFor ? formatInTimeZone(entry.item.scheduledFor, TZ, "EEE d MMM, HH:mm") : null;
        return (
          <ECard key={entry.item.id} className="border-[hsl(var(--e-gold))]">
            <ECardBody className="space-y-2 pt-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-[0.9375rem] font-[600] [overflow-wrap:anywhere]">{entry.item.title}</p>
                {/* The offered price, or a plain statement that none is set. Never $0. */}
                {pay ? (
                  <span className="e-tnum shrink-0 text-[0.9375rem] font-[600]">{describePay(pay)}</span>
                ) : (
                  <EBadge tone="neutral" soft>No price set</EBadge>
                )}
              </div>
              <p className="flex flex-wrap items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {place ? (
                  <>
                    <MapPin className="h-3 w-3" aria-hidden /> {place}
                  </>
                ) : null}
                {entry.item.area ? <span>· {entry.item.area}</span> : null}
                {before ? <span>· planned {before}</span> : null}
              </p>
              {entry.item.description ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{entry.item.description}</p>
              ) : null}
              <MaintenanceAssignmentActions assignment={entry.assignment} />
            </ECardBody>
          </ECard>
        );
      })}
    </section>
  );
}
