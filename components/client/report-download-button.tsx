"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadFromApi } from "@/lib/client/download";
import { toast } from "@/hooks/use-toast";

export function ClientReportDownloadButton({
  jobId,
  label = "Download PDF",
  variant = "outline",
}: {
  jobId: string;
  label?: string;
  variant?: "default" | "outline";
}) {
  const [downloading, setDownloading] = useState(false);

  return (
    <Button
      size="sm"
      variant={variant}
      disabled={downloading}
      onClick={async () => {
        try {
          setDownloading(true);
          await downloadFromApi(`/api/reports/${jobId}/download`, `job-report-${jobId}.pdf`);
        } catch (error: any) {
          toast({
            title: "Report download failed",
            description: error?.message || "Unable to prepare the PDF report right now.",
            variant: "destructive",
          });
        } finally {
          setDownloading(false);
        }
      }}
    >
      {downloading ? "Preparing PDF..." : label}
    </Button>
  );
}
