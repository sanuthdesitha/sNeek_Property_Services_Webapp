"use client";

/**
 * Expanded cleaner row, as drawn: that cleaner's open issues with their
 * actions on the left, a by-category breakdown and "Open all N in Issues" on
 * the right. Issues are read from the hub's paged list (same filters, this
 * cleaner, open fixes only). Mark fixed and Propose deduction open the issue
 * detail on that form (minutes, photos, amount and note stay required as
 * before); Reject / Confirm decide a suspected false confirmation through the
 * existing endpoint.
 */
import * as React from "react";
import Link from "next/link";
import { toast } from "@/hooks/use-toast";
import { EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { cn } from "@/lib/utils";
import { formatIssueDayShort, hoursSince, qaPhotoKeyList, severityTone } from "../issues/issue-format";
import { patchIssue } from "../issues/issue-requests";
import type { CleanerRow, HubContext, QualityIssueRow } from "./hub-types";
import { isIssues } from "./hub-types";
import { useQualityRead, useReloadOn } from "./use-quality-read";
import { severityLabel } from "@/lib/quality/severity";

const PREVIEW_SIZE = 5;
const DANGER_OUTLINE = "border-[hsl(var(--e-danger)/0.45)] text-[hsl(var(--e-danger))] hover:bg-[hsl(var(--e-danger-soft))]";

export type OpenIssueRequest = { issue: QualityIssueRow; action: "rectify" | "deduction" | null };

function IssueLine({
  issue,
  context,
  labelFor,
  busy,
  onOpen,
  onDecide,
}: {
  issue: QualityIssueRow;
  context: HubContext;
  labelFor: (key: string) => string;
  busy: boolean;
  onOpen: (request: OpenIssueRequest) => void;
  onDecide: (issue: QualityIssueRow, decision: "CONFIRMED" | "REJECTED") => void;
}) {
  const photos = qaPhotoKeyList(issue.qaPhotoKeys).length;
  const age = hoursSince(issue.createdAt);
  const meta = [
    issue.job?.propertyName ?? issue.property?.name ?? null,
    formatIssueDayShort(issue.createdAt, context.timeZone),
    issue.raisedBy?.name ? `raised by ${issue.raisedBy.name}` : null,
    issue.falseConfirmation === "SUSPECTED" ? "suspected false confirmation" : null,
    photos > 0 ? `${photos} photo${photos === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const confirmLabel = context.falseConfirmationDeduction === null ? "Confirm" : `Confirm, −${context.falseConfirmationDeduction}`;

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2">
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onOpen({ issue, action: null })} className="text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
          {issue.description.length > 90 ? `${issue.description.slice(0, 90)}…` : issue.description || labelFor(issue.category)}
        </button>{" "}
        <EPill tone={severityTone(issue.severity)}>{severityLabel(issue.severity)}</EPill>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{meta.join(" · ")}</p>
      </div>
      {context.canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {issue.falseConfirmation === "SUSPECTED" ? (
            <>
              <EButton size="sm" variant="outline" disabled={busy} onClick={() => onDecide(issue, "REJECTED")}>
                Reject
              </EButton>
              <EButton size="sm" variant="outline" className={DANGER_OUTLINE} disabled={busy} onClick={() => onDecide(issue, "CONFIRMED")}>
                {confirmLabel}
              </EButton>
            </>
          ) : (
            <>
              {issue.rectificationStatus === "PENDING" && age !== null ? <EPill tone="warn">{`Fix pending ${age} h`}</EPill> : null}
              <EButton size="sm" variant="outline" disabled={busy} onClick={() => onOpen({ issue, action: "rectify" })}>
                Mark fixed
              </EButton>
              <EButton size="sm" variant="outline" disabled={busy} onClick={() => onOpen({ issue, action: "deduction" })}>
                Propose deduction
              </EButton>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function CleanerExpanded({
  row,
  apiQuery,
  context,
  labelFor,
  issuesHref,
  refreshToken,
  onOpenIssue,
  onChanged,
}: {
  row: CleanerRow;
  /** Period + shared filters, already serialised. */
  apiQuery: string;
  context: HubContext;
  labelFor: (key: string) => string;
  issuesHref: string;
  refreshToken: number;
  onOpenIssue: (request: OpenIssueRequest) => void;
  onChanged: () => void;
}) {
  const params = new URLSearchParams(apiQuery);
  params.set("cleanerId", row.cleanerId);
  params.set("openFixes", "1");
  params.set("pageSize", String(PREVIEW_SIZE));
  const read = useQualityRead(`/api/admin/quality/issues?${params.toString()}`, isIssues, "Open issues could not be loaded.");
  useReloadOn(refreshToken, read.reload);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const firstName = row.name.split(" ")[0] || row.name;
  const maxCategory = Math.max(1, ...row.categories.map((category) => category.count));

  async function decide(issue: QualityIssueRow, decision: "CONFIRMED" | "REJECTED") {
    setBusyId(issue.id);
    const result = await patchIssue(issue.id, { action: "falseConfirmation", decision });
    setBusyId(null);
    if (!result.ok) {
      toast({ title: "Not saved", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: decision === "CONFIRMED" ? "False confirmation confirmed" : "False confirmation rejected" });
    onChanged();
  }

  const rows = read.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start">
      <div className="min-w-0 flex-1 space-y-1.5">
        <EEyebrow>{`${firstName}'s open issues`}</EEyebrow>
        {read.loading && !read.data ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p> : null}
        {read.error ? (
          <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
            {read.data ? "Showing the last loaded issues. " : ""}
            {read.error}{" "}
            <button type="button" className="underline" onClick={read.reload}>
              Try again
            </button>
          </p>
        ) : null}
        {read.data && rows.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No open fixes in this period.</p>
        ) : null}
        <ul className="space-y-1.5">
          {rows.map((issue) => (
            <IssueLine key={issue.id} issue={issue} context={context} labelFor={labelFor} busy={busyId !== null} onOpen={onOpenIssue} onDecide={(i, d) => void decide(i, d)} />
          ))}
        </ul>
        {read.data && read.data.total > rows.length ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{`Showing ${rows.length} of ${read.data.total} open.`}</p>
        ) : null}
      </div>
      <div className="w-full space-y-1.5 md:w-[240px] md:flex-none">
        <EEyebrow>By category</EEyebrow>
        {row.categories.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No issues in this period.</p> : null}
        {row.categories.map((category, index) => (
          <div key={category.category} className="space-y-1">
            <div className="flex justify-between gap-2 text-[0.8125rem]">
              <span className="truncate">{category.label}</span>
              <span className="e-tnum">{category.count}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--e-surface-sunken))]" aria-hidden>
              <i
                className={cn("block h-full rounded-full", index === 0 && row.categories.length > 1 ? "bg-[hsl(var(--e-danger))]" : "bg-[hsl(var(--e-primary))]")}
                style={{ width: `${Math.round((category.count / maxCategory) * 100)}%` }}
              />
            </div>
          </div>
        ))}
        {row.issues.total > 0 ? (
          <Link href={issuesHref} className="inline-block pt-1 text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
            {`Open all ${row.issues.total} in Issues`}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
