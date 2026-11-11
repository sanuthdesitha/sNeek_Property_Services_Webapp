"use client";

/**
 * Columns of the Job forms table, in the concept's order: Form (name and
 * version line), Status, Used by, Questions, Avg time, Completion, Checks,
 * Changed, and the row's Edit action with its "more" menu.
 */
import * as React from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import type { EDataColumn } from "@/components/v2/ui/data-table";
import type { FormLibraryRow, FormLibrarySort, FormLibraryStatus, FormUsage } from "@/lib/forms/library-types";
import { FormRowMenu, type FormRowActions } from "./form-row-menu";

const STATUS: Record<FormLibraryStatus, { label: string; tone: EPillTone }> = {
  live: { label: "Live", tone: "ok" },
  "live-draft": { label: "Live + draft", tone: "info" },
  draft: { label: "Draft", tone: "warn" },
  archived: { label: "Archived", tone: "neutral" },
};

function versionLine(row: FormLibraryRow): string {
  const parts = [`v${row.version}`];
  if (row.status === "live-draft") parts.push("draft has unpublished changes");
  else if (row.status === "draft") parts.push("not published yet");
  else if (row.usage.kind === "default") parts.push("default for job type");
  else if (row.usage.kind === "property") parts.push("property override");
  else if (row.usage.kind === "job") parts.push("made for one job");
  parts.push(row.serviceType.replace(/_/g, " ").toLowerCase());
  return parts.join(" · ");
}

function usedByText(usage: FormUsage): string {
  switch (usage.kind) {
    case "default":
    case "property":
      return `${usage.properties} propert${usage.properties === 1 ? "y" : "ies"}`;
    case "job":
      return "1 job";
    case "unused":
      return "Not used";
    default:
      return "–";
  }
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "–";
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
}

export function formatChanged(iso: string, timezone: string, now = new Date()): string {
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const date = new Date(iso);
  if (day(date) === day(now)) return "Today";
  const sameYear = day(date).slice(0, 4) === day(now).slice(0, 4);
  return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}

function ChecksCell({ row }: { row: FormLibraryRow }) {
  const { checks } = row;
  const first = checks.issues[0]?.message;
  const pill =
    checks.status === "pass" ? (
      <EPill tone="ok">Passes</EPill>
    ) : checks.status === "errors" ? (
      <EPill tone="bad">{checks.errors} problem{checks.errors === 1 ? "" : "s"}</EPill>
    ) : (
      <EPill tone="warn">{checks.warnings} warning{checks.warnings === 1 ? "" : "s"}</EPill>
    );
  return (
    <div className="max-w-[16rem] space-y-1">
      <span title={checks.issues.map((issue) => issue.message).join("\n") || "Every validator passes."}>{pill}</span>
      {first ? <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]" title={first}>{first}</p> : null}
      {row.neverAnswered.length > 0 ? (
        <p
          className="text-[0.75rem] font-[500] text-[hsl(var(--e-warning))]"
          title={`Required and always shown, but not answered in any of the last ${row.usageSample} submissions since this version went live.`}
        >
          Never answered: {row.neverAnswered.map((q) => q.label).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

export function formColumns(options: {
  timezone: string;
  statsWeeks: number;
  canWrite: boolean;
  actions: FormRowActions;
  busyId: string | null;
}): Array<EDataColumn<FormLibraryRow, FormLibrarySort>> {
  const basis = `Last ${options.statsWeeks} weeks; "–" when there are too few submissions to say.`;
  return [
    {
      key: "form",
      header: "Form",
      sortKey: "name",
      cell: (row) => (
        <div className="min-w-[12rem]">
          <p className="font-[600] text-[hsl(var(--e-foreground))]">{row.name}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{versionLine(row)}</p>
        </div>
      ),
    },
    { key: "status", header: "Status", sortKey: "status", cell: (row) => <EPill tone={STATUS[row.status].tone}>{STATUS[row.status].label}</EPill> },
    { key: "usedBy", header: "Used by", sortKey: "usedBy", firstDir: "desc", cell: (row) => <span className="whitespace-nowrap">{usedByText(row.usage)}</span> },
    { key: "questions", header: "Questions", sortKey: "questions", align: "right", className: "e-tnum", cell: (row) => row.questions },
    {
      key: "avg",
      header: <span title={`Average time from start to submit. ${basis}`}>Avg time</span>,
      align: "right",
      className: "e-tnum whitespace-nowrap",
      cell: (row) => formatMinutes(row.avgMinutes),
    },
    {
      key: "completion",
      header: <span title={`Share of required, always-shown questions answered. ${basis}`}>Completion</span>,
      align: "right",
      className: "e-tnum",
      cell: (row) => (row.completionPct === null ? "–" : `${row.completionPct}%`),
    },
    { key: "checks", header: "Checks", sortKey: "checks", firstDir: "desc", cell: (row) => <ChecksCell row={row} /> },
    {
      key: "changed",
      header: "Changed",
      sortKey: "changed",
      firstDir: "desc",
      className: "whitespace-nowrap text-[hsl(var(--e-muted-foreground))]",
      cell: (row) => formatChanged(row.changedAt, options.timezone),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (row) =>
        options.canWrite ? (
          <div className="flex items-center justify-end gap-1.5">
            <EButton size="sm" variant="outline" className="h-7 px-2.5 text-[0.75rem]" asChild>
              <Link href={`/v2/admin/forms/${row.id}/edit`} aria-label={`Edit ${row.name}`}>Edit</Link>
            </EButton>
            <FormRowMenu row={row} actions={options.actions} busy={options.busyId === row.id} />
          </div>
        ) : (
          <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Read only</span>
        ),
    },
  ];
}
