"use client";

/**
 * Estate report PDF control — same endpoint as the legacy download button:
 *   GET /api/reports/[jobId]/download (blob → save as job-report-*.pdf)
 */
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { downloadFromApi } from "@/lib/client/download";

export function EstateReportDownloadButton({
  jobId,
  label = "Download PDF",
}: {
  jobId: string;
  label?: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <EButton
        variant="outline-gold"
        size="sm"
        disabled={downloading}
        onClick={async () => {
          setError(null);
          try {
            setDownloading(true);
            await downloadFromApi(`/api/reports/${jobId}/download`, `job-report-${jobId}.pdf`);
          } catch (err: any) {
            setError(err?.message || "Unable to prepare the PDF right now.");
          } finally {
            setDownloading(false);
          }
        }}
      >
        {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {downloading ? "Preparing…" : label}
      </EButton>
      {error ? (
        <span className="text-[0.6875rem] text-[hsl(var(--e-danger))]" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
