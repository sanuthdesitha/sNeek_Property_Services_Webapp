/**
 * The laundry partner's usual pickup and drop schedule, shown to its team in
 * the laundry portal (owner decision 2026-11-13). Server component, PLAIN
 * helpers only. Descriptive: it is what the office recorded on the partner,
 * not a promise or a plan for any run; null / empty says nothing is recorded.
 */
import { ECard } from "@/components/v2/ui/primitives";
import { describeLeg, noServiceDays, scheduleStated, type PartnerSchedule } from "@/lib/laundry/partner-schedule";

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type PartnerScheduleCardData = { partnerName: string; schedule: PartnerSchedule } | null;

export function PartnerScheduleCard({ data, failed = false }: { data: PartnerScheduleCardData; failed?: boolean }) {
  if (failed) {
    return <ECard className="p-3 text-[0.8125rem]" role="status">Your pickup and drop schedule could not be loaded.</ECard>;
  }
  if (!data) return null;
  const { partnerName, schedule } = data;
  const rows: Array<[string, string]> = scheduleStated(schedule)
    ? [
        ["Pickups", describeLeg(schedule, "pickup") ?? "Not stated"],
        ["Drops", describeLeg(schedule, "drop") ?? "Not stated"],
        ...noServiceDays(schedule).map((day): [string, string] => [WEEKDAY_LONG[day], "No service"]),
      ]
    : [];
  return (
    <ECard className="space-y-1.5 p-3">
      <h2 className="text-[0.875rem] font-[600]">{partnerName} pickup and drop schedule</h2>
      {rows.length ? (
        <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[0.8125rem]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-[hsl(var(--e-muted-foreground))]">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No schedule is recorded for {partnerName}. Ask the office to add your usual days and times.</p>
      )}
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Usual days and times recorded by the office. Each run keeps its own day and planned time.</p>
    </ECard>
  );
}
