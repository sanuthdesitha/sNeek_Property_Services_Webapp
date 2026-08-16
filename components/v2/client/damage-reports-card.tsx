"use client";

/**
 * D4 — damage reports on the client's job page.
 *
 * Renders nothing at all when there are none to show, which is the common case:
 * an empty "Damage" heading on every clean would imply damage is expected, and
 * the API only ever returns reports an admin has released.
 *
 * Downloads go through the shared dialog so the client's damage download looks
 * and behaves like their cleaning download. The copy they receive is the
 * redacted one — repair costs are stripped server-side, not hidden here.
 */

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { EBadge, ECard, ECardBody, EButton } from "@/components/v2/ui/primitives";
import { DownloadButton } from "@/components/v2/shared/report-download-dialog";

type ClientDamageSummary = {
  id: string;
  status: string;
  submittedAt: string | null;
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

export function DamageReportsCard({ jobId }: { jobId: string }) {
  const [reports, setReports] = React.useState<ClientDamageSummary[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/client/jobs/${jobId}/damage-reports`);
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!cancelled && Array.isArray(data.reports)) setReports(data.reports);
      } catch {
        // Silent: this card is supplementary, and an error here must not break
        // the job page around it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (reports.length === 0) return null;

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
          <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-danger))]" />
          Damage reported at this clean
        </p>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Our team documented the following and has reviewed it before sharing it with you.
        </p>

        {reports.map((report) => (
          <div
            key={report.id}
            className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius-md)] border border-[hsl(var(--e-border))] p-2"
          >
            <EBadge tone={SEVERITY_TONE[report.highestSeverity ?? ""] ?? "neutral"}>
              {report.highestSeverity ? titleCase(report.highestSeverity) : "Reported"}
            </EBadge>
            <span className="text-[0.8125rem]">
              {report.itemCount} item{report.itemCount === 1 ? "" : "s"}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <EButton size="sm" variant="ghost" asChild>
                <a href={`/v2/client/damage/${report.id}`}>View details</a>
              </EButton>
              <DownloadButton
                variant="outline"
                label="Download"
                target={{
                  kind: "DAMAGE",
                  url: `/api/damage/${report.id}/report`,
                  filename: `damage-report-${report.id}.pdf`,
                  description:
                    "A record of the damage found, with photos. Carries a code you can check at /verify.",
                }}
              />
            </div>
          </div>
        ))}
      </ECardBody>
    </ECard>
  );
}
