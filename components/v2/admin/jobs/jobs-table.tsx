"use client";

/**
 * The Jobs table: sortable headers, Sydney-day group rows, selection, one
 * visible action (Assign, when nobody is on the job) and a "more" menu.
 * Clicking a row (or its property name, for keyboards) opens the peek panel.
 */
import { useMemo } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { EDataTable, type EDataColumn, type TableSort } from "@/components/v2/ui/data-table";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EButton } from "@/components/v2/ui/primitives";
import { groupJobsBySydneyDay } from "@/lib/jobs/date-grouping";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import type { JobsColumnSort } from "@/lib/jobs/list-sort";
import type { JobsColumns } from "@/lib/jobs/workspace-state";
import { FlagPills, JobStatusPill, assignmentNames, canQuickAssign, jobTypeLabel, timeWindowLabel, type JobsDensityValue } from "./job-row";
import type { JobListRow, JobsTableSort } from "./jobs-query";

export function chargeLabel(amount: number): string {
  return `$${amount.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function ChargeCell({ job }: { job: JobListRow }) {
  if (!job.charge) return <span className="text-[hsl(var(--e-text-faint))]">Not loaded</span>;
  if (job.charge.missing || job.charge.amount === null) return <EPill tone="warn">No rate</EPill>;
  return <span className="e-tnum">{chargeLabel(job.charge.amount)}</span>;
}

export function GuestInCell({ job }: { job: JobListRow }) {
  const guest = job.guestIn;
  if (!guest) return <span className="text-[hsl(var(--e-text-faint))]">Not loaded</span>;
  const time = guest.checkinAt ? formatInTimeZone(new Date(guest.checkinAt), SYDNEY_TZ, "HH:mm") : null;
  const date = !time && guest.stayStartDate ? formatInTimeZone(new Date(`${guest.stayStartDate}T12:00:00Z`), SYDNEY_TZ, "d MMM") : null;
  if (!time && !date && !guest.sameDay) return <span className="text-[hsl(var(--e-muted-foreground))]">None</span>;
  return (
    <span className="e-tnum inline-flex flex-wrap items-center gap-1.5">
      {time ?? date ?? <span className="text-[hsl(var(--e-muted-foreground))]">Time not set</span>}
      {guest.sameDay ? <EPill tone="warn">Same day</EPill> : null}
    </span>
  );
}

type JobsTableProps = {
  jobs: JobListRow[];
  columns: JobsColumns;
  density: JobsDensityValue;
  sort: JobsTableSort | null;
  onSortChange: (sort: JobsTableSort) => void;
  selected: ReadonlySet<string>;
  onSelectionChange: (next: Set<string>) => void;
  activeJobId: string | null;
  onOpen: (job: JobListRow) => void;
  onQuickAssign: (job: JobListRow) => void;
  menuItems: (job: JobListRow) => ERowMenuItem[];
  loading: boolean;
  staleError: string | null;
  onRetry: () => void;
  selectionDisabled?: boolean;
};

const PADDING: Record<JobsDensityValue, string> = { compact: "px-3 py-1.5", default: "px-3 py-2.5", comfortable: "px-3 py-4" };

export function JobsTable(props: JobsTableProps) {
  const { jobs, columns: visible, onOpen, onQuickAssign, menuItems } = props;
  const showGuestIn = jobs.some((job) => job.guestIn !== undefined);
  const showCharge = jobs.some((job) => job.charge !== undefined);

  const columns = useMemo(() => {
    const list: Array<EDataColumn<JobListRow, JobsColumnSort>> = [];
    if (visible.schedule) {
      list.push({ key: "when", header: "When", sortKey: "when", className: "e-tnum whitespace-nowrap", cell: (job) => timeWindowLabel(job) });
    }
    list.push({
      key: "property", header: "Property", sortKey: "property", className: "min-w-[12rem]",
      cell: (job) => (
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpen(job)}
            className="text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
          >
            <span className="sr-only">Preview </span>{job.property?.name ?? "Unknown property"}
          </button>
          <div className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {[job.property?.suburb, job.jobNumber ? String(job.jobNumber) : null].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-1 flex flex-wrap gap-1 empty:hidden"><FlagPills job={job} /></div>
        </div>
      ),
    });
    if (visible.client) {
      list.push({ key: "client", header: "Client", sortKey: "client", cell: (job) => job.property?.client?.name ?? <span className="text-[hsl(var(--e-text-faint))]">No client</span> });
    }
    list.push({ key: "type", header: "Type", sortKey: "type", className: "whitespace-nowrap", cell: (job) => jobTypeLabel(job.jobType) });
    if (visible.cleaner) {
      list.push({
        key: "cleaner", header: "Cleaner",
        cell: (job) => {
          if (canQuickAssign(job)) {
            return <EButton size="sm" variant="outline" onClick={() => onQuickAssign(job)} aria-label={`Assign a cleaner to ${job.property?.name ?? "this job"}`}>Assign</EButton>;
          }
          const names = assignmentNames(job);
          return names.length > 0 ? names.join(", ") : <span className="text-[hsl(var(--e-text-faint))]">Nobody assigned</span>;
        },
      });
    }
    list.push({ key: "status", header: "Status", sortKey: "status", cell: (job) => <JobStatusPill status={job.status} /> });
    if (showGuestIn) list.push({ key: "guest", header: "Guest in", cell: (job) => <GuestInCell job={job} /> });
    if (showCharge) list.push({ key: "charge", header: "Charge", align: "right", cell: (job) => <ChargeCell job={job} /> });
    list.push({
      key: "actions", header: <span className="sr-only">Actions</span>, className: "w-[44px]",
      cell: (job) => <ERowMenu label={`More actions for ${job.property?.name ?? "job"}`} items={menuItems(job)} />,
    });
    return list;
  }, [visible, showGuestIn, showCharge, onOpen, onQuickAssign, menuItems]);

  const groups = useMemo(
    () => groupJobsBySydneyDay(props.jobs.map((job) => ({ ...job, scheduledDate: job.scheduledDate ?? null })), new Date())
      .map((group) => ({ key: group.dayKey, label: group.label, rows: group.jobs as JobListRow[] })),
    [props.jobs],
  );

  return (
    <EDataTable<JobListRow, JobsColumnSort>
      label="Jobs"
      columns={columns}
      rows={props.jobs}
      groups={groups}
      rowKey={(job) => job.id}
      sort={props.sort as TableSort<JobsColumnSort> | null}
      onSortChange={(next) => props.onSortChange({ key: next.key, dir: next.dir })}
      selection={{
        selected: props.selected,
        onChange: props.onSelectionChange,
        rowLabel: (job) => `Select ${job.property?.name ?? "job"} ${job.jobNumber ?? ""}`.trim(),
        disabled: props.selectionDisabled,
      }}
      onRowClick={onOpen}
      activeRowKey={props.activeJobId}
      loading={props.loading}
      error={props.staleError}
      onRetry={props.onRetry}
      cellPadding={PADDING[props.density]}
      minWidth="64rem"
      emptyTitle="Nothing on the books"
      emptyDescription="No jobs match the current view. Adjust the date, status or search."
    />
  );
}
