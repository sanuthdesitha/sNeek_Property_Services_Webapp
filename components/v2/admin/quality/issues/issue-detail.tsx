"use client";

/**
 * QA issue detail, opened from the Issues tab or an expanded cleaner row.
 * Keeps everything the old QA issues drawer had: facts, description, QA
 * photos, before/after rectification photos, the job link and (for ADMIN /
 * OPS_MANAGER) every action. QA inspectors see it read-only.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EModal } from "@/components/v2/admin/estate-kit";
import type { QualityIssueRow } from "@/lib/quality/issue-rows";
import {
  falseConfirmationTone,
  formatIssueDate,
  keyList,
  qaPhotoKeyList,
  rectificationTone,
  severityTone,
  titleCaseKey,
} from "./issue-format";
import { EvidenceStrip, useEvidenceUrls } from "./issue-evidence";
import { IssueActions, type IssueActionKey } from "./issue-actions";

export type IssueDetailProps = {
  issue: QualityIssueRow;
  categoryLabel: string;
  canManage: boolean;
  initialAction?: IssueActionKey | null;
  falseConfirmationDeduction: number | null;
  timeZone: string;
  onClose: () => void;
  /** Called after a successful action; the caller re-reads its lists. */
  onChanged: () => void | Promise<void>;
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">{label}</dt>
      <dd className="text-[0.875rem] text-[hsl(var(--e-foreground))]">{children}</dd>
    </div>
  );
}

function payAdjustmentText(issue: QualityIssueRow): string {
  const pa = issue.payAdjustment;
  if (!pa) return "–";
  const parts = [pa.status ? titleCaseKey(pa.status) : "Status unknown"];
  if (typeof pa.requestedAmount === "number") parts.push(`$${Math.abs(pa.requestedAmount).toFixed(2)}`);
  if (pa.source) parts.push(pa.source.replace(/_/g, " ").toLowerCase());
  return parts.join(" · ");
}

export function IssueDetail({
  issue,
  categoryLabel,
  canManage,
  initialAction = null,
  falseConfirmationDeduction,
  timeZone,
  onClose,
  onChanged,
}: IssueDetailProps) {
  const photoKeys = React.useMemo(() => qaPhotoKeyList(issue.qaPhotoKeys), [issue]);
  const beforeKeys = React.useMemo(() => keyList(issue.rectificationBeforeKeys), [issue]);
  const afterKeys = React.useMemo(() => keyList(issue.rectificationAfterKeys), [issue]);
  // One resolver for all three strips: the same job-scoped media rail.
  const urls = useEvidenceUrls([...photoKeys, ...beforeKeys, ...afterKeys], issue.jobId);
  const propertyName = issue.job?.propertyName ?? issue.property?.name ?? "–";

  return (
    <EModal open onClose={onClose} wide eyebrow="QA issue" title={categoryLabel}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <EPill tone={severityTone(issue.severity)}>{titleCaseKey(issue.severity)}</EPill>
          <EPill tone={rectificationTone(issue.rectificationStatus)}>{titleCaseKey(issue.rectificationStatus)}</EPill>
          {issue.falseConfirmation && issue.falseConfirmation !== "NONE" ? (
            <EPill tone={falseConfirmationTone(issue.falseConfirmation)}>False confirmation: {titleCaseKey(issue.falseConfirmation)}</EPill>
          ) : null}
          {issue.guestReadyImpact ? <EPill tone="bad">Guest-ready impact</EPill> : null}
          {issue.cleanerMarkedComplete ? <EPill tone="info">Cleaner marked complete</EPill> : null}
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="Cleaner">{issue.cleaner?.name || "–"}</Fact>
          <Fact label="Raised by">{issue.raisedBy?.name || "–"}</Fact>
          <Fact label="Property / job">
            {propertyName}
            {issue.job?.jobNumber ? ` · Job #${issue.job.jobNumber}` : ""}
            {issue.job?.scheduledDate ? ` · ${formatIssueDate(issue.job.scheduledDate, timeZone)}` : ""}
          </Fact>
          <Fact label="Raised">{formatIssueDate(issue.createdAt, timeZone)}</Fact>
          {issue.review ? (
            <Fact label="Linked review">
              {typeof issue.review.score === "number" ? `${issue.review.score.toFixed(0)}%` : "–"}
              {issue.review.rating ? ` · ${titleCaseKey(issue.review.rating)}` : ""}
            </Fact>
          ) : null}
          {issue.payAdjustment ? <Fact label="Pay adjustment">{payAdjustmentText(issue)}</Fact> : null}
          {issue.rectificationMinutes != null ? <Fact label="Rectification minutes">{`${issue.rectificationMinutes} min`}</Fact> : null}
        </dl>

        <div>
          <EEyebrow className="mb-1">Description</EEyebrow>
          <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{issue.description}</p>
        </div>

        {photoKeys.length > 0 ? (
          <div>
            <EEyebrow className="mb-2">QA evidence ({photoKeys.length})</EEyebrow>
            <EvidenceStrip keys={photoKeys} urls={urls} alt="QA evidence" />
          </div>
        ) : null}
        {beforeKeys.length > 0 ? (
          <div>
            <EEyebrow className="mb-2">Before rectification ({beforeKeys.length})</EEyebrow>
            <EvidenceStrip keys={beforeKeys} urls={urls} alt="Before rectification" />
          </div>
        ) : null}
        {afterKeys.length > 0 ? (
          <div>
            <EEyebrow className="mb-2">After rectification ({afterKeys.length})</EEyebrow>
            <EvidenceStrip keys={afterKeys} urls={urls} alt="After rectification" />
          </div>
        ) : null}

        {issue.jobId ? (
          <EButton variant="outline-gold" size="sm" asChild>
            <Link href={`/v2/admin/jobs/${issue.jobId}`}>
              Open job <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </EButton>
        ) : null}

        {canManage ? (
          <IssueActions
            issue={issue}
            initialAction={initialAction}
            falseConfirmationDeduction={falseConfirmationDeduction}
            onChanged={onChanged}
          />
        ) : (
          <p className="border-t border-[hsl(var(--e-border))] pt-4 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Read-only view — you do not have permission to action QA issues.
          </p>
        )}
      </div>
    </EModal>
  );
}
