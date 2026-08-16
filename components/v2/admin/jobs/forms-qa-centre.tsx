"use client";

/**
 * D4 — the job-level Forms & QA centre (admin).
 *
 * One place listing every document a job has produced: the cleaning report, the
 * QA report, and each damage report. Before this, the cleaning and QA reports
 * were reachable from `ReportActions` and damage reports were reachable from
 * nowhere at all — a submitted damage report existed only as cases, so an admin
 * had no way to find the report that grouped them.
 *
 * Every download opens the SAME dialog (components/v2/shared/report-download-dialog),
 * tone-coded per kind. That is a requirement, not a preference: the tree already
 * has four hand-rolled modal shells, and this is where a fifth would otherwise
 * have appeared.
 */

import * as React from "react";
import { AlertTriangle, ClipboardCheck, FileText, Loader2 } from "lucide-react";
import { EAlert, EBadge, ECard, ECardBody, EButton } from "@/components/v2/ui/primitives";
import { DownloadButton } from "@/components/v2/shared/report-download-dialog";

type DamageSummary = {
  id: string;
  status: string;
  clientVisible: boolean;
  submittedAt: string | null;
  reviewedAt: string | null;
  reportedByName: string | null;
  itemCount: number;
  highestSeverity: string | null;
};

const SEVERITY_TONE: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  SEVERE: "danger",
  MAJOR: "danger",
  MODERATE: "warning",
  MINOR: "info",
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function FormsQaCentre({
  jobId,
  hasReport,
  hasQaReview,
}: {
  jobId: string;
  /** A cleaning report exists (or can be lazily generated) for this job. */
  hasReport: boolean;
  /** A QA review exists, so a QA report can be rendered. */
  hasQaReview: boolean;
}) {
  const [damage, setDamage] = React.useState<DamageSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/jobs/${jobId}/damage-reports`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load damage reports.");
        if (!cancelled) setDamage(Array.isArray(data.reports) ? data.reports : []);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const cleaningCompanion = hasReport
    ? { url: `/api/reports/${jobId}/download`, filename: `job-report-${jobId}.pdf` }
    : null;

  return (
    <ECard>
      <ECardBody className="space-y-4 pt-6">
        <div>
          <p className="text-[0.9375rem] font-[600]">Forms &amp; QA centre</p>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Every document this job has produced, in one place.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--e-border))] pt-3">
          <FileText className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
          <span className="text-[0.875rem]">Cleaning report</span>
          <div className="ml-auto">
            {hasReport ? (
              <DownloadButton
                variant="outline"
                label="Download"
                target={{
                  kind: "CLEANING",
                  url: `/api/reports/${jobId}/download`,
                  filename: `job-report-${jobId}.pdf`,
                  description: "The full cleaning report for this job, as sent to the client.",
                }}
              />
            ) : (
              <EBadge tone="neutral">Not generated</EBadge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--e-border))] pt-3">
          <ClipboardCheck className="h-4 w-4 text-[hsl(var(--e-info))]" />
          <span className="text-[0.875rem]">QA report</span>
          <div className="ml-auto">
            {hasQaReview ? (
              <DownloadButton
                variant="outline"
                label="Download"
                target={{
                  kind: "QA",
                  url: `/api/qa/jobs/${jobId}/report`,
                  filename: `qa-report-${jobId}.pdf`,
                  description:
                    "The internal QA copy — carries inspector notes and any pay clawbacks.",
                }}
              />
            ) : (
              <EBadge tone="neutral">No QA review</EBadge>
            )}
          </div>
        </div>

        <div className="space-y-2 border-t border-[hsl(var(--e-border))] pt-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-danger))]" />
            <span className="text-[0.875rem]">Damage reports</span>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          </div>

          {error ? <EAlert tone="danger">{error}</EAlert> : null}

          {!loading && damage.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              No damage reported on this job.
            </p>
          ) : null}

          {damage.map((report) => (
            <div
              key={report.id}
              className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius-md)] border border-[hsl(var(--e-border))] p-2"
            >
              <EBadge tone={SEVERITY_TONE[report.highestSeverity ?? ""] ?? "neutral"}>
                {report.highestSeverity ? titleCase(report.highestSeverity) : "No items"}
              </EBadge>
              <span className="text-[0.8125rem]">
                {report.itemCount} item{report.itemCount === 1 ? "" : "s"}
                {report.reportedByName ? ` · ${report.reportedByName}` : ""}
              </span>
              <EBadge tone="neutral">{titleCase(report.status)}</EBadge>
              {report.clientVisible ? (
                <EBadge tone="success">Released</EBadge>
              ) : (
                <EBadge tone="warning">Not released</EBadge>
              )}

              <div className="ml-auto flex items-center gap-2">
                <EButton size="sm" variant="ghost" asChild>
                  <a href={`/v2/admin/damage/${report.id}`}>Investigate</a>
                </EButton>
                {report.status === "DRAFT" ? (
                  <EBadge tone="neutral">Draft — not submitted</EBadge>
                ) : (
                  <DownloadButton
                    variant="outline"
                    label="Download"
                    cleaningCompanion={cleaningCompanion}
                    target={{
                      kind: "DAMAGE",
                      url: `/api/damage/${report.id}/report`,
                      filename: `damage-report-${report.id}.pdf`,
                      description:
                        "The internal copy — includes per-item repair costs, which the client's copy never shows.",
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </ECardBody>
    </ECard>
  );
}
