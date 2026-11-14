"use client";

/**
 * Phones (below 640px, board "Maintenance" phone frames 1 and 6): the list as
 * stacked cards. A card that needs someone takes the title band (wine for
 * urgent, honey for waiting on someone) with the reason in its pill; the rest
 * stay plain with the status in the pill. Each card has at most one button,
 * "Assign…", when nobody is on it; everything else is in its "⋯" sheet.
 *
 * Select mode shows a checkbox on every card; the bulk bar then docks at the
 * bottom. Rendered only once the viewport is known to be a phone.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EToneBand, ETonePill } from "@/components/v2/ui/tone-band";
import type { ERowMenuItem } from "@/components/v2/ui/row-menu";
import { PhoneActionSheet } from "@/components/v2/admin/phone-action-sheet";
import { STATUS_LABELS } from "@/lib/maintenance/labels";
import { isOpenMaintenanceStatus } from "@/lib/maintenance/attention";
import type { MaintenanceListRow } from "@/lib/maintenance/admin-list-types";
import { costSummary, priorityTone, statusTone, visitParts, ageLabel } from "./maintenance-format";
import { PRIORITY_LABELS, SOURCE_LABELS } from "@/lib/maintenance/labels";

function CardFacts({ row, timeZone }: { row: MaintenanceListRow; timeZone: string }) {
  const visit = visitParts(row.scheduledFor, timeZone);
  const cost = costSummary(row);
  const who = row.nobodyAssigned
    ? `${SOURCE_LABELS[row.source]}, ${ageLabel(row.createdAt) ?? "date not recorded"}`
    : row.assignedWorker
      ? [row.assignedWorker.name, row.assignedWorker.company].filter(Boolean).join(", ")
      : row.roster.map((person) => person.name).join(", ");
  return (
    <div className="space-y-1 text-[0.8125rem]">
      <p className="flex flex-wrap gap-x-3 gap-y-0.5">
        <b>{STATUS_LABELS[row.status]}</b>
        <span className="text-[hsl(var(--e-text-secondary))]">{who}</span>
        {visit ? <span>Visit <b>{visit.day} {visit.time}</b></span> : null}
      </p>
      {row.costApprovalStatus || row.photoCount > 0 ? (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[hsl(var(--e-text-secondary))]">
          {row.costApprovalStatus ? <span>Client price <b className="text-[hsl(var(--e-foreground))]">{cost.amount ?? "no amount"}</b> {cost.note.toLowerCase()}</span> : null}
          {row.photoCount > 0 ? <span>{row.photoCount} photo{row.photoCount === 1 ? "" : "s"}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

export function MaintenancePhoneList({
  rows,
  timeZone,
  selecting,
  selected,
  onToggle,
  onOpen,
  onAssign,
  menuFor,
}: {
  rows: MaintenanceListRow[];
  timeZone: string;
  selecting: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpen: (row: MaintenanceListRow) => void;
  onAssign: (row: MaintenanceListRow) => void;
  menuFor: (row: MaintenanceListRow) => ERowMenuItem[];
}) {
  const [menuRow, setMenuRow] = React.useState<MaintenanceListRow | null>(null);
  return (
    <>
      <ul aria-label="Maintenance items" className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const tone = row.attention?.tone ?? null;
          const checked = selected.has(row.id);
          const header = (
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              {selecting ? (
                <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-[hsl(var(--e-primary))]" checked={checked} aria-label={`Select ${row.title}`} onChange={() => onToggle(row.id)} />
              ) : null}
              <div className="min-w-0">
                <button type="button" onClick={() => (selecting ? onToggle(row.id) : onOpen(row))} className="text-left text-[0.9375rem] font-semibold [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
                  {row.title}
                </button>
                <p className="text-[0.75rem] opacity-80">{[row.property.name, row.area].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
          );
          const pill = tone && row.attention ? (
            <ETonePill tone={tone} className="max-w-[45%] whitespace-normal text-right">{row.priority === "URGENT" && row.attention.reason !== "Urgent" ? `Urgent · ${row.attention.reason.toLowerCase()}` : row.attention.reason}</ETonePill>
          ) : selecting ? (
            <EPill tone={priorityTone(row.priority)}>{PRIORITY_LABELS[row.priority]}</EPill>
          ) : (
            <EPill tone={statusTone(row.status)}>{STATUS_LABELS[row.status]}</EPill>
          );
          const showAssign = !selecting && row.nobodyAssigned && isOpenMaintenanceStatus(row.status);
          return (
            <li
              key={row.id}
              className={cn(
                "overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
                checked && "border-[hsl(var(--e-primary)/0.45)] bg-[hsl(var(--e-primary-soft))]",
              )}
            >
              {tone ? (
                <EToneBand tone={tone} className="flex items-start justify-between gap-2 px-3 py-2.5">{header}{pill}</EToneBand>
              ) : (
                <div className="flex items-start justify-between gap-2 px-3 py-2.5">{header}{pill}</div>
              )}
              {!selecting ? (
                <div className="space-y-2 border-t border-[hsl(var(--e-border))] px-3 py-2.5 first:border-t-0">
                  {showAssign ? (
                    <>
                      <CardFacts row={row} timeZone={timeZone} />
                      <div className="flex gap-2">
                        <EButton size="sm" variant="outline" className="flex-1" onClick={() => onAssign(row)}>Assign…</EButton>
                        <EButton size="icon" variant="outline" aria-label={`More for ${row.title}`} onClick={() => setMenuRow(row)}>⋯</EButton>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1"><CardFacts row={row} timeZone={timeZone} /></div>
                      <EButton size="icon" variant="ghost" aria-label={`More for ${row.title}`} className="-mr-1.5 -mt-1.5 shrink-0" onClick={() => setMenuRow(row)}>⋯</EButton>
                    </div>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <PhoneActionSheet open={menuRow !== null} onOpenChange={(open) => { if (!open) setMenuRow(null); }} title={menuRow?.title ?? "Item"} items={menuRow ? menuFor(menuRow) : []} />
    </>
  );
}
