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
          <EPill tone={severityTone(issue.severity)}>{titleCaseKey(issue.severity)}</EPill>
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
