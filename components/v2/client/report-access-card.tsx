"use client";

/**
 * The client's access to a job's report, in one place.
 *
 * Previously the whole card was hidden unless the report was already generated
 * AND released, so a client whose report was not yet shared saw nothing at all —
 * no explanation, and no way to ask for it. That reads as "there is no report",
 * which is rarely true; usually it simply has not been released yet.
 *
 * So the card always renders, and shows one of two things: a download, or a
 * request. Downloads go through the shared dialog every other document uses, so
 * the report behaves like the damage report beside it.
 */

import * as React from "react";
import { FileText, Loader2, Send } from "lucide-react";
import {
  EAlert,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { DownloadButton } from "@/components/v2/shared/report-download-dialog";

export function ReportAccessCard({
  jobId,
  available,
  subtitle,
}: {
  jobId: string;
  /** The report exists and the client is allowed to see it. */
  available: boolean;
  subtitle: string;
}) {
  const [requesting, setRequesting] = React.useState(false);
  const [requested, setRequested] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function requestReport() {
    setRequesting(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/jobs/${jobId}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "REPORT" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send the request.");
      setRequested(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRequesting(false);
    }
  }

  return (
    <ECard id="job-report">
      <ECardHeader>
        <ECardTitle className="flex items-center gap-2 text-[1rem]">
          <FileText className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Cleaning report
        </ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[0.875rem] font-medium">Job report</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {available ? subtitle : "Not shared with you yet."}
            </p>
          </div>

          {available ? (
            <DownloadButton
              variant="outline"
              label="Download"
              target={{
                kind: "CLEANING",
                url: `/api/reports/${jobId}/download`,
                filename: `job-report-${jobId}.pdf`,
                description: "The full record of this clean, including photos.",
              }}
            />
          ) : requested ? (
            <EButton variant="outline" size="sm" disabled>
              Requested
            </EButton>
          ) : (
            <EButton variant="outline" size="sm" onClick={requestReport} disabled={requesting}>
              {requesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Request report
            </EButton>
          )}
        </div>

        {requested ? (
          <EAlert tone="success">
            Request sent — our team will share the report with you shortly.
          </EAlert>
        ) : null}
        {error ? <EAlert tone="danger">{error}</EAlert> : null}
      </ECardBody>
    </ECard>
  );
}
