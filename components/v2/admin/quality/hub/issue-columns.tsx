"use client";

/**
 * Columns of the Issues tab table. Every sortable column maps to a key the
 * server's allow-list accepts (ISSUE_SORTS).
 */
import Link from "next/link";
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { caseHref } from "@/lib/quality/case-origin";
import { EPill } from "@/components/v2/ui/pill";
import type { IssueSort } from "@/lib/quality/types";
import * as React from "react";
import {
  falseConfirmationTone,
  formatIssueMoment,
  rectificationTone,
  severityTone,
} from "../issues/issue-format";
import {
  falseConfirmationDetailText,
  falseConfirmationLabel,
  fixDetailText,
  issueAttention,
  rectificationLabel,
} from "@/lib/quality/issue-presentation";
import { toneRowCellClass } from "@/components/v2/ui/tone-band";
import type { QualityIssueRow } from "./hub-types";
import { severityLabel } from "@/lib/quality/severity";
import { EButton } from "@/components/v2/ui/primitives";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { OPEN_RECTIFICATION_STATUSES, type RectificationStatusKey } from "@/lib/quality/types";
import type { IssueActionKey } from "../issues/issue-action-forms";

export type IssueColumnOptions = {
  labelFor: (key: string) => string;
  timeZone: string;
  onOpen: (issue: QualityIssueRow) => void;
  /** settings.accountability.scoring.falseConfirmationExtraDeduction, or null when unknown. */
  falseConfirmationDeduction?: number | null;
};

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{children}</span>;
}

/**
 * Board "QualitySubpages": six columns beside the issue panel. The raised date
 * and where it was raised from sit under the issue name; fix minutes and cost
 * sit under the fix status. A row that needs someone is tinted behind its
 * first cells (see `issueLeadCellClass`) and its pill says why.
 */
export function issueColumns({ labelFor, timeZone, onOpen, falseConfirmationDeduction = null }: IssueColumnOptions): Array<EDataColumn<QualityIssueRow, IssueSort>> {
  return [
    {
      key: "created",
      header: "Issue · raised",
      sortKey: "created",
      firstDir: "desc",
      cell: (issue) => {
        const attention = issueAttention(issue);
        return (
          <span className="block max-w-[17rem]">
            <button
              type="button"
              onClick={() => onOpen(issue)}
              className="text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
            >
              {labelFor(issue.category)}
            </button>
            <span className="block text-[0.8125rem] text-[hsl(var(--e-text-secondary))] [overflow-wrap:anywhere]">{issue.description}</span>
            <Muted>
              <span className="e-tnum">{formatIssueMoment(issue.createdAt, timeZone)}</span>
              {" · "}
              {issue.raisedFromCaseId ? (
                <Link href={caseHref(issue.raisedFromCaseId)} className="underline underline-offset-2">from case</Link>
              ) : (
                "QA review"
              )}
            </Muted>
            {attention ? <span className="sr-only">{attention.reason}.</span> : null}
          </span>
        );
      },
    },
    {
      key: "cleaner",
      header: "Cleaner · property",
      sortKey: "cleaner",
      cell: (issue) => (
        <span className="block">
          <span className="block">{issue.cleaner?.name || "–"}</span>
          <Muted>
            {issue.job?.propertyName ?? issue.property?.name ?? "–"}
            {issue.job?.jobNumber ? <span className="whitespace-nowrap">{` · ${issue.job.jobNumber}`}</span> : null}
          </Muted>
        </span>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      sortKey: "severity",
      firstDir: "desc",
      cell: (issue) => (
        <span className="inline-flex flex-col items-start gap-1">
          <EPill tone={severityTone(issue.severity)}>{severityLabel(issue.severity)}</EPill>
          {issue.guestReadyImpact ? <EPill tone="bad">Guest-ready</EPill> : null}
        </span>
      ),
    },
    {
      key: "rectification",
      header: "Fix",
      sortKey: "rectification",
      cell: (issue) => {
        const detail = fixDetailText(issue);
        return (
          <span className="block">
            <EPill tone={rectificationTone(issue.rectificationStatus)}>{rectificationLabel(issue.rectificationStatus)}</EPill>
            {detail ? <Muted>{detail}</Muted> : null}
          </span>
        );
      },
    },
    {
      key: "falseConfirmation",
      header: "False confirmation",
      cell: (issue) => {
        if (!issue.falseConfirmation || issue.falseConfirmation === "NONE") return <span className="text-[hsl(var(--e-text-secondary))]">None</span>;
        const detail = falseConfirmationDetailText(issue.falseConfirmation, falseConfirmationDeduction);
        return (
          <span className="block">
            <EPill tone={falseConfirmationTone(issue.falseConfirmation)}>{falseConfirmationLabel(issue.falseConfirmation)}</EPill>
            {detail ? <Muted>{detail}</Muted> : null}
          </span>
        );
      },
    },
  ];
}

/** Tint behind the leading cells of a row that needs someone (never a left line). */
export function issueLeadCellClass(issue: QualityIssueRow): string | undefined {
  const attention = issueAttention(issue);
  return attention ? toneRowCellClass(attention.tone) : undefined;
}

/**
 * Phones only (board "M-PeopleQuality", issue cards): the card's actions. A
 * suspected false confirmation opens the issue for its Reject / Confirm
 * decision; an open fix offers Mark fixed; "⋯" holds Propose deduction,
 * Escalate and Open. Each one only opens the existing issue detail on that
 * form, where the same fields, rules and requests apply.
 */
export function issuePhoneActionsColumn({
  labelFor,
  onOpen,
  onAction,
}: {
  labelFor: (key: string) => string;
  onOpen: (issue: QualityIssueRow) => void;
  onAction: (issue: QualityIssueRow, action: IssueActionKey) => void;
}): EDataColumn<QualityIssueRow, IssueSort> {
  return {
    key: "phoneActions",
    header: <span className="sr-only">Actions</span>,
    cell: (issue) => {
      const name = labelFor(issue.category);
      const openFix = OPEN_RECTIFICATION_STATUSES.includes(issue.rectificationStatus as RectificationStatusKey);
      const suspected = issue.falseConfirmation === "SUSPECTED";
      return (
        <span className="flex w-full flex-wrap items-center justify-end gap-2">
          {suspected ? (
            <EButton size="sm" variant="outline" onClick={() => onOpen(issue)}>Review false confirmation</EButton>
          ) : openFix ? (
            <EButton size="sm" variant="outline" onClick={() => onAction(issue, "rectify")}>Mark fixed</EButton>
          ) : null}
          <ERowMenu
            label={`More actions for ${name}`}
            triggerVariant="outline"
            items={[
              { key: "deduction", label: "Propose deduction", onSelect: () => onAction(issue, "deduction") },
              { key: "escalate", label: "Escalate", onSelect: () => onAction(issue, "escalate") },
              ...(!suspected && !openFix ? [{ key: "rectify", label: "Mark fixed", onSelect: () => onAction(issue, "rectify") }] : []),
              { key: "open", label: "Open issue", onSelect: () => onOpen(issue), separated: true },
            ]}
          />
        </span>
      );
    },
  };
}
