"use client";

/**
 * Maintenance table columns (board "Maintenance"): Item (photo, title, reason
 * pill when something waits on someone, property · area · action · category),
 * Priority · status, Assigned, Visit, Cost, Reported, and the row menu. The
 * title is a real button that opens the side panel, so keyboards reach it.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { tonePillClass } from "@/components/v2/ui/tone-band";
import { ACTION_LABELS, CATEGORY_LABELS, PRIORITY_LABELS, SOURCE_LABELS, STATUS_LABELS } from "@/lib/maintenance/labels";
import type { MaintenanceListRow, MaintenanceListSort } from "@/lib/maintenance/admin-list-types";
import { ageLabel, ASSIGNEE_ROLE_SHORT, costSummary, priorityTone, statusTone, visitParts } from "./maintenance-format";

export function MaintenanceThumb({ row }: { row: Pick<MaintenanceListRow, "photoUrl" | "photoCount"> }) {
  if (!row.photoUrl) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[hsl(var(--e-surface-sunken))] text-center text-[0.59375rem] leading-tight text-[hsl(var(--e-muted-foreground))]">
        {row.photoCount > 0 ? `${row.photoCount} photo${row.photoCount === 1 ? "" : "s"}` : "No photo"}
      </span>
    );
  }
  return (
    <span className="relative h-10 w-10 shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={row.photoUrl} alt="" className="h-10 w-10 rounded-[8px] object-cover" />
      <span className="absolute -bottom-1 -right-1 rounded-full border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-1 text-[0.625rem] font-semibold">{row.photoCount}</span>
    </span>
  );
}

export function rowSubline(row: MaintenanceListRow): string {
  return [row.property.name, row.area, ACTION_LABELS[row.recommendedAction], CATEGORY_LABELS[row.category]].filter(Boolean).join(" · ");
}

function CostCell({ row }: { row: MaintenanceListRow }) {
  const cost = costSummary(row);
  return (
    <div className="e-tnum">
      {cost.amount ? <div>{cost.amount}</div> : null}
      <div
        className={cn(
          "text-[0.75rem]",
          cost.tone === "warning" && "font-[600] text-[hsl(var(--e-warning))]",
          cost.tone === "danger" && "font-[600] text-[hsl(var(--e-danger))]",
          cost.tone === "success" && "text-[hsl(var(--e-success))]",
          cost.tone === "muted" && "text-[hsl(var(--e-muted-foreground))]",
        )}
      >
        {cost.note}
      </div>
    </div>
  );
}

function AssignedCell({ row }: { row: MaintenanceListRow }) {
  if (row.nobodyAssigned) return <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Nobody yet</span>;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-[0.75rem]">
      <b className="text-[0.8125rem]">{row.assignedWorker ? row.assignedWorker.company || row.assignedWorker.name : "Office"}</b>
      <span className="flex flex-wrap gap-1">
        {row.assignedWorker && row.assignedWorker.company ? (
          <span className="rounded-full border border-[hsl(var(--e-border))] px-1.5 text-[0.65625rem] text-[hsl(var(--e-text-secondary))]">Worker: {row.assignedWorker.name}</span>
        ) : row.assignedWorker && !row.assignedWorker.hasLogin ? (
          <span className="rounded-full border border-[hsl(var(--e-border))] px-1.5 text-[0.65625rem] text-[hsl(var(--e-text-secondary))]">{row.assignedWorker.trade ? `${row.assignedWorker.trade} · ` : ""}ad hoc</span>
        ) : null}
        {row.roster.map((person, index) => (
          <span key={`${person.role}-${index}`} className="rounded-full border border-[hsl(var(--e-border))] px-1.5 text-[0.65625rem] text-[hsl(var(--e-text-secondary))]">
            {ASSIGNEE_ROLE_SHORT[person.role]}: {person.name}
          </span>
        ))}
      </span>
    </div>
  );
}

export function maintenanceColumns(input: {
  timeZone: string;
  onOpen: (row: MaintenanceListRow) => void;
  menuFor: (row: MaintenanceListRow) => ERowMenuItem[];
  now?: Date;
}): Array<EDataColumn<MaintenanceListRow, MaintenanceListSort>> {
  const { timeZone, onOpen, menuFor } = input;
  return [
    {
      key: "item",
      header: "Item",
      sortKey: "title",
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <MaintenanceThumb row={row} />
          <div className="min-w-0">
            <button type="button" onClick={() => onOpen(row)} className="text-left font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
              {row.title}
            </button>{" "}
            {row.attention ? <span className={tonePillClass(row.attention.tone)}>{row.attention.reason}</span> : null}
            {!row.clientVisible ? <EPill className="ml-1 h-[18px]">Internal</EPill> : null}
            <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{rowSubline(row)}</div>
          </div>
        </div>
      ),
    },
    {
      key: "priority",
      header: "Priority · status",
      sortKey: "priority",
      firstDir: "desc",
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <EPill tone={priorityTone(row.priority)}>{PRIORITY_LABELS[row.priority]}</EPill>
          <EPill tone={statusTone(row.status)}>{STATUS_LABELS[row.status]}</EPill>
        </div>
      ),
    },
    { key: "assigned", header: "Assigned", sortKey: "assigned", cell: (row) => <AssignedCell row={row} /> },
    {
      key: "visit",
      header: "Visit",
      sortKey: "visit",
      className: "whitespace-nowrap",
      cell: (row) => {
        const parts = visitParts(row.scheduledFor, timeZone, input.now);
        if (!parts) return <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Not booked</span>;
        return (
          <div className="e-tnum">
            {parts.day}
            <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{parts.time}</div>
          </div>
        );
      },
    },
    { key: "cost", header: "Cost", sortKey: "cost", firstDir: "desc", align: "right", cell: (row) => <CostCell row={row} /> },
    {
      key: "reported",
      header: "Reported",
      sortKey: "reported",
      firstDir: "desc",
      className: "whitespace-nowrap",
      cell: (row) => (
        <div className="text-[0.75rem]">
          {SOURCE_LABELS[row.source]}
          <div className="text-[hsl(var(--e-muted-foreground))]">{ageLabel(row.createdAt, input.now) ?? "Date not recorded"}</div>
          {row.job?.jobNumber ? <div className="text-[hsl(var(--e-muted-foreground))]">from {row.job.jobNumber}</div> : null}
        </div>
      ),
    },
    {
      key: "menu",
      header: <span className="sr-only">Actions</span>,
      className: "w-[44px]",
      cell: (row) => <ERowMenu label={`More for ${row.title}`} items={menuFor(row)} />,
    },
  ];
}
