"use client";

/**
 * The waiting requests of one queue (or of all queues) as a table: search,
 * type chips with counts, one primary action per row and the rest in "more".
 * Row selection feeds the bulk bar, which only offers decisions the queue
 * allows in bulk and otherwise says why.
 */
import * as React from "react";
import Link from "next/link";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EButton } from "@/components/v2/ui/primitives";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { cn } from "@/lib/utils";
import { APPROVAL_QUEUES } from "@/lib/admin/approvals/queues";
import { DAY_MS, typeChips, waitedMs, waitingLabel, type ApprovalQueueRow } from "@/lib/admin/approvals/rows";
import { primaryActionFor, type RowPrimary } from "./row-actions";
import type { QueueSelection } from "./use-approvals-state";

type QueueTableProps = {
  queue: QueueSelection;
  rows: ApprovalQueueRow[];
  /** Real total for the queue; more than rows.length when the list was capped. */
  total: number | null;
  now: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  openId: string | null;
  onOpen: (row: ApprovalQueueRow) => void;
  onPrimary: (row: ApprovalQueueRow, action: RowPrimary) => void;
  onQuickDecline: (row: ApprovalQueueRow) => void;
  busy: boolean;
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
};

export function QueueTable(props: QueueTableProps) {
  const { queue, rows, total, now } = props;
  const [search, setSearch] = React.useState("");
  const [chip, setChip] = React.useState("all");
  const capped = total != null && total > rows.length;

  // A different queue starts with no search, no chip and no selection.
  React.useEffect(() => {
    setSearch("");
    setChip("all");
  }, [queue]);

  const chips = queue === "all" ? [] : typeChips(rows);
  const term = search.trim().toLowerCase();
  const shown = rows.filter((row) => (chip === "all" || row.type.key === chip) && (!term || row.search.includes(term)));
  const label = queue === "all" ? "All waiting requests" : APPROVAL_QUEUES[queue].label;

  const columns: Array<EDataColumn<ApprovalQueueRow>> = [
    {
      key: "who",
      header: queue === "clientApprovals" || queue === "bookingRequests" ? "Client" : "Requested by",
      cell: (row) => (
        <button type="button" onClick={() => props.onOpen(row)} className="text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
          {row.who}
        </button>
      ),
    },
    ...(queue === "all" ? [{ key: "queue", header: "Queue", cell: (row: ApprovalQueueRow) => APPROVAL_QUEUES[row.queue].label }] : []),
    {
      key: "job",
      header: "Job",
      cell: (row) => (
        <div className="min-w-0">
          {row.jobId && row.jobLabel ? <Link href={`/v2/admin/jobs/${row.jobId}`} className="text-[hsl(var(--e-primary))] hover:underline">{row.jobLabel}</Link> : <span>{row.jobLabel ?? "—"}</span>}
          {row.propertyName ? <div className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.propertyName}</div> : null}
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (row) => (
        <div className="min-w-0">
          {row.type.label}
          {row.typeDetail ? <div className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.typeDetail}</div> : null}
        </div>
      ),
    },
    { key: "asked", header: "Asked", align: "right", cell: (row) => <span className="e-tnum">{row.asked ?? "—"}</span> },
    {
      key: "waiting",
      header: "Waiting",
      cell: (row) => {
        const ms = waitedMs(row, now);
        const late = ms != null && ms >= DAY_MS;
        return <span className={cn("e-tnum whitespace-nowrap", late && "font-[600] text-[hsl(var(--e-danger))]")}>{waitingLabel(ms)}</span>;
      },
    },
    {
      key: "primary",
      header: <span className="sr-only">Action</span>,
      cell: (row) => {
        const primary = primaryActionFor(row);
        if (primary.kind === "link") {
          return <EButton size="sm" variant="outline" asChild><Link href={primary.href}>{primary.label}</Link></EButton>;
        }
        return (
          <EButton size="sm" variant={primary.kind === "approve" ? "primary" : "outline"} disabled={props.busy} onClick={() => props.onPrimary(row, primary)}>
            {primary.label}
          </EButton>
        );
      },
    },
    {
      key: "more",
      header: <span className="sr-only">More</span>,
      cell: (row) => <ERowMenu label={`More actions for ${row.who}`} items={menuItems(row, props)} disabled={props.busy} />,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="approvals-search">Search requests</label>
        <input
          id="approvals-search"
          className="h-9 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:w-[220px] sm:text-[0.8125rem] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]"
          placeholder="Search cleaner, property, job"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {chips.length > 1 ? (
          <div role="group" aria-label="Request type" className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={chip === "all"} className={cn(E_CHIP_CLASS, chip === "all" && E_CHIP_ON_CLASS)} onClick={() => setChip("all")}>
              All{capped ? null : <span className="e-tnum">{rows.length}</span>}
            </button>
            {chips.map((item) => (
              <button key={item.key} type="button" aria-pressed={chip === item.key} className={cn(E_CHIP_CLASS, chip === item.key && E_CHIP_ON_CLASS)} onClick={() => setChip(item.key)}>
                {item.label}
                {capped ? null : <span className="e-tnum">{item.count}</span>}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {capped ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Showing the {rows.length} longest-waiting of {total}. Decide some to see the rest; type counts cover the shown rows only, so they are hidden.
        </p>
      ) : null}
      <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        <EDataTable
          label={label}
          columns={columns}
          rows={shown}
          rowKey={(row) => `${row.queue}:${row.id}`}
          loading={props.loading}
          error={props.error}
          onRetry={props.onRetry}
          emptyTitle={term || chip !== "all" ? "No requests match" : "Nothing waiting"}
          emptyDescription={term || chip !== "all" ? "Clear the search or type filter." : "No pending items in this queue."}
          minWidth="720px"
          onRowClick={props.onOpen}
          activeRowKey={props.openId ? shown.find((row) => row.id === props.openId)?.queue + ":" + props.openId : null}
          selection={
            queue === "all" || APPROVAL_QUEUES[queue].reviewOnly
              ? undefined
              : {
                  selected: props.selected,
                  onChange: props.onSelectedChange,
                  rowLabel: (row) => `Select ${row.who}${row.jobLabel ? ` ${row.jobLabel}` : ""}`,
                  disabled: props.busy,
                }
          }
        />
      </div>
    </div>
  );
}

function menuItems(row: ApprovalQueueRow, props: QueueTableProps): ERowMenuItem[] {
  const queue = APPROVAL_QUEUES[row.queue];
  const items: ERowMenuItem[] = [{ key: "open", label: queue.reviewOnly ? "Show details" : "Review in panel", onSelect: () => props.onOpen(row) }];
  if (row.jobId) items.push({ key: "job", label: "View job", href: `/v2/admin/jobs/${row.jobId}` });
  if (row.queue === "bookingRequests" && row.record.property?.id) items.push({ key: "property", label: "View property", href: `/v2/admin/properties/${row.record.property.id}` });
  if (row.queue === "payAdjustments") items.push({ key: "pay", label: "View pay request", href: "/v2/admin/finance?tab=adjustments" });
  if (queue.bulk.decline.allowed) {
    items.push({ key: "decline", label: queue.bulk.decline.label.replace(/ with one note$/, ""), danger: true, separated: true, onSelect: () => props.onQuickDecline(row) });
  }
  return items;
}
