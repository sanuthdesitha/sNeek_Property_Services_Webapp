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
import {
  falseConfirmationTone,
  formatIssueDate,
  rectificationTone,
  severityTone,
  titleCaseKey,
} from "../issues/issue-format";
import type { QualityIssueRow } from "./hub-types";
import { severityLabel } from "@/lib/quality/severity";
import { EButton } from "@/components/v2/ui/primitives";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { OPEN_RECTIFICATION_STATUSES, type RectificationStatusKey } from "@/lib/quality/types";
import type { IssueActionKey } from "../issues/issue-actions";

export function issueColumns({
  labelFor,
  timeZone,
  onOpen,
}: {
  labelFor: (key: string) => string;
  timeZone: string;
  onOpen: (issue: QualityIssueRow) => void;
}): Array<EDataColumn<QualityIssueRow, IssueSort>> {
  return [
    {
      key: "created",
      header: "Raised",
      sortKey: "created",
      firstDir: "desc",
      className: "whitespace-nowrap",
      cell: (issue) => <span className="e-tnum text-[hsl(var(--e-text-secondary))]">{formatIssueDate(issue.createdAt, timeZone)}</span>,
    },
    {
      key: "category",
      header: "Issue",
      sortKey: "category",
      cell: (issue) => (
        <button
          type="button"
          onClick={() => onOpen(issue)}
          className="max-w-[18rem] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
        >
          <span className="block font-[600] hover:underline">{labelFor(issue.category)}</span>
          <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{issue.description}</span>
        </button>
      ),
    },
    {
      key: "origin",
      header: "Raised from",
      cell: (issue) =>
        issue.raisedFromCaseId ? (
          <Link href={caseHref(issue.raisedFromCaseId)} className="whitespace-nowrap text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">Raised from case</Link>
        ) : (
          <span className="text-[hsl(var(--e-text-faint))]">QA review</span>
        ),
    },
    {
      key: "cleaner",
      header: "Cleaner",
      sortKey: "cleaner",
      cell: (issue) => issue.cleaner?.name || "–",
    },
    {
      key: "property",
      header: "Property / job",
      sortKey: "property",
      cell: (issue) => (
        <span>
          <span className="block">{issue.job?.propertyName ?? issue.property?.name ?? "–"}</span>
          {issue.job?.jobNumber ? <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Job #{issue.job.jobNumber}</span> : null}
        </span>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      sortKey: "severity",
      firstDir: "desc",
      cell: (issue) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <EPill tone={severityTone(issue.severity)}>{severityLabel(issue.severity)}</EPill>
          {issue.guestReadyImpact ? <EPill tone="bad">Guest-ready</EPill> : null}
        </span>
      ),
    },
    {
      key: "rectification",
      header: "Rectification",
      sortKey: "rectification",
      cell: (issue) => <EPill tone={rectificationTone(issue.rectificationStatus)}>{titleCaseKey(issue.rectificationStatus)}</EPill>,
    },
    {
      key: "falseConfirmation",
      header: "False confirmation",
      cell: (issue) =>
        issue.falseConfirmation && issue.falseConfirmation !== "NONE" ? (
          <EPill tone={falseConfirmationTone(issue.falseConfirmation)}>{titleCaseKey(issue.falseConfirmation)}</EPill>
        ) : (
          <span className="text-[hsl(var(--e-text-faint))]">–</span>
        ),
    },
  ];
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
