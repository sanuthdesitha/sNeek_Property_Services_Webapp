"use client";

/**
 * "Coming up, from the calendar and jobs": each turnover day in the next
 * three weeks with the guest leaving, the guest arriving, the job, its
 * cleaners and the laundry run. Gaps are written out ("No booking yet",
 * "Job created at next sync", "No laundry service"); "Assign" opens the job's
 * peek on the Jobs page, where suggestions and the assign step already live.
 */
import Link from "next/link";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { STATUS_LABELS } from "@/lib/jobs/status-labels";
import { sydneyRelativeDayLabel } from "@/lib/jobs/date-grouping";
import { jobHref, jobPeekHref } from "@/lib/properties/links";
import type { ComingUpLaundryCell, ComingUpRow } from "@/lib/properties/coming-up";
import type { PropertyOverview } from "@/lib/properties/preview-types";
import type { Remote } from "./use-property-summaries";

const STATUS_TONE: Record<string, EPillTone> = { UNASSIGNED: "bad", OFFERED: "warn", ASSIGNED: "ok", SUBMITTED: "gold", QA_REVIEW: "gold" };

function dayText(dayKey: string): string {
  const label = sydneyRelativeDayLabel(dayKey);
  if (label !== "Today" && label !== "Tomorrow") return label;
  return `${label}, ${new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${dayKey}T00:00:00Z`))}`;
}

function guestText(guest: { name: string | null; time: string | null }): string {
  return [guest.name ?? "Guest (no name in feed)", guest.time].filter(Boolean).join(" ");
}

function laundryText(cell: ComingUpLaundryCell): React.ReactNode {
  switch (cell.kind) {
    case "pickup":
      return cell.sameDay ? `Pickup ${cell.time ?? "time not planned"}` : `Pickup ${sydneyRelativeDayLabel(cell.dayKey)}${cell.time ? ` ${cell.time}` : ""}`;
    case "status":
      return cell.label;
    case "not-needed":
      return "No pickup needed";
    case "off":
      return <span className="text-[hsl(var(--e-muted-foreground))]">No laundry service</span>;
    case "none":
      return <span className="text-[hsl(var(--e-muted-foreground))]">–</span>;
  }
}

function Row({ row }: { row: ComingUpRow }) {
  return (
    <tr className="border-t border-[hsl(var(--e-border))]">
      <td className="e-tnum whitespace-nowrap px-2.5 py-2">{dayText(row.dayKey)}</td>
      <td className="px-2.5 py-2">{row.guestOut ? guestText(row.guestOut) : <span className="text-[hsl(var(--e-muted-foreground))]">No checkout</span>}</td>
      <td className="px-2.5 py-2">
        {row.guestIn ? guestText(row.guestIn) : <span className="text-[hsl(var(--e-muted-foreground))]">No booking yet</span>}
        {row.sameDay ? <EPill tone="warn" className="ml-1">Same day</EPill> : null}
      </td>
      <td className="whitespace-nowrap px-2.5 py-2">
        {row.job ? (
          <>
            <Link className="underline" href={jobHref(row.job.id)}>{row.job.jobNumber}</Link>{" "}
            <EPill tone={STATUS_TONE[row.job.status] ?? "info"}>{STATUS_LABELS[row.job.status] ?? row.job.status}</EPill>
          </>
        ) : (
          <span className="text-[hsl(var(--e-muted-foreground))]">{row.missingJob === "created-at-next-sync" ? "Job created at next sync" : "No job"}</span>
        )}
      </td>
      <td className="px-2.5 py-2">
        {row.job && row.cleaners.length === 0 ? (
          <EButton asChild size="sm" variant="outline"><Link href={jobPeekHref(row.job.id)}>Assign</Link></EButton>
        ) : row.cleaners.length > 0 ? row.cleaners.join(", ") : <span className="text-[hsl(var(--e-muted-foreground))]">–</span>}
      </td>
      <td className="whitespace-nowrap px-2.5 py-2">{laundryText(row.laundry)}</td>
    </tr>
  );
}

export function ComingUpCard({ overview, onShowJobs }: { overview: Remote<PropertyOverview>; onShowJobs: () => void }) {
  const data = overview.data;
  return (
    <ECard className="min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-4 pb-2">
        <h2 className="text-[0.9375rem] font-[600]">Coming up, from the calendar and jobs</h2>
        <button type="button" className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline" onClick={onShowJobs}>All jobs and history</button>
      </div>
      {overview.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 px-4 pb-3 text-[0.8125rem]">
          <span className="text-[hsl(var(--e-danger))]">{data ? "Showing the last loaded list. " : ""}{overview.error}</span>
          <EButton size="sm" variant="outline" onClick={overview.reload}>Try again</EButton>
        </div>
      ) : null}
      {!data && overview.loading ? <p role="status" className="px-4 pb-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p> : null}
      {data && data.comingUp.length === 0 ? (
        <p className="px-4 pb-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No checkouts or jobs in the next {data.comingUpWindowDays} days.</p>
      ) : null}
      {data && data.comingUp.length > 0 ? (
        <div role="region" aria-label="Coming up" tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-[0.8125rem]">
            <thead>
              <tr className="bg-[hsl(var(--e-surface-raised))] text-left text-[0.6875rem] font-semibold text-[hsl(var(--e-muted-foreground))]">
                {["Date", "Guest out", "Guest in", "Job", "Cleaner", "Laundry"].map((head) => <th key={head} scope="col" className="px-2.5 py-2">{head}</th>)}
              </tr>
            </thead>
            <tbody>{data.comingUp.map((row) => <Row key={row.key} row={row} />)}</tbody>
          </table>
        </div>
      ) : null}
    </ECard>
  );
}
