"use client";

/**
 * One generated report in the PDFs manager: select box, property / client /
 * job type / date, the three visibility toggles (client, cleaner, laundry),
 * PDF download, regenerate and delete. Write controls are disabled for a
 * viewer whose reports pack is read-only (the server would refuse them).
 */
import * as React from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { Download, FileText, RefreshCcw, Trash2 } from "lucide-react";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import type { ReportRow as Report, VisibilityPatch } from "./report-types";

type Toggle = { key: keyof VisibilityPatch; on: string; off: string; tone: "gold" | "info" | "success"; title: string };

const TOGGLES: Toggle[] = [
  { key: "clientVisible", on: "Client sees it", off: "Hidden from client", tone: "gold", title: "Toggle client visibility" },
  { key: "cleanerVisible", on: "Cleaner sees it", off: "Hidden from cleaner", tone: "info", title: "Toggle cleaner visibility" },
  { key: "laundryVisible", on: "Laundry sees it", off: "Hidden from laundry", tone: "success", title: "Toggle laundry visibility" },
];

/** The scheduled date is a calendar day: shown in the organisation timezone, never shifted. */
function serviceDay(value: string | null | undefined, timeZone: string): string {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "–" : formatInTimeZone(date, timeZone, "dd MMM yyyy");
}

export function ReportRowView({
  report,
  timeZone,
  selected,
  onSelect,
  canManage,
  busy,
  generating,
  onToggle,
  onDownload,
  onRegenerate,
  onDelete,
}: {
  report: Report;
  timeZone: string;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  canManage: boolean;
  busy: boolean;
  generating: boolean;
  onToggle: (patch: VisibilityPatch) => void;
  onDownload: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const propertyName = report.job?.property?.name ?? "Property";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-5 py-4 last:border-0 hover:bg-[hsl(var(--e-muted))]">
      <div className="flex min-w-0 items-center gap-3">
        <input
          type="checkbox"
          className="h-[15px] w-[15px] shrink-0 accent-[hsl(var(--e-primary))]"
          aria-label={`Select report for ${propertyName}`}
          checked={selected}
          disabled={!canManage}
          onChange={(event) => onSelect(event.target.checked)}
        />
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
          <FileText aria-hidden className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <Link href={`/v2/admin/jobs/${report.jobId}`} className="block truncate text-[0.875rem] font-[550] hover:underline">
            {propertyName}
          </Link>
          <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {report.job?.property?.client?.name ?? "–"} · {String(report.job?.jobType ?? "").replace(/_/g, " ")} ·{" "}
            {serviceDay(report.job?.scheduledDate, timeZone)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {report.sentToClient ? <EBadge tone="success" soft>Sent to client</EBadge> : null}
        {TOGGLES.map((toggle) => {
          const on = report[toggle.key];
          return (
            <button
              key={toggle.key}
              type="button"
              disabled={busy || !canManage}
              aria-pressed={on}
              onClick={() => onToggle({ [toggle.key]: !on })}
              className="rounded-[var(--e-radius-pill)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] disabled:opacity-50"
              title={toggle.title}
            >
              <EBadge tone={on ? toggle.tone : "neutral"} soft={on}>
                {on ? toggle.on : toggle.off}
              </EBadge>
            </button>
          );
        })}
        <EButton variant="ghost" size="sm" onClick={onDownload}>
          <Download aria-hidden className="h-3.5 w-3.5" /> PDF
        </EButton>
        <EButton variant="ghost" size="sm" disabled={generating || !canManage} onClick={onRegenerate}>
          <RefreshCcw aria-hidden className="h-3.5 w-3.5" />
          {generating ? "Generating…" : "Regenerate"}
        </EButton>
        <EButton
          variant="ghost"
          size="sm"
          aria-label={`Delete report for ${propertyName}`}
          disabled={!canManage}
          className="text-[hsl(var(--e-danger))] hover:text-[hsl(var(--e-danger))]"
          onClick={onDelete}
        >
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
        </EButton>
      </div>
    </div>
  );
}
