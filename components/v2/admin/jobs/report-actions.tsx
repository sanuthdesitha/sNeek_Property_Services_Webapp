"use client";

/**
 * ESTATE job report actions — v2 parity with the v1 job-detail "Report actions"
 * card (app/admin/jobs/[id]/page.tsx). Reuses the already-shared, role-agnostic
 * routes; no backend changes:
 *   • GET   /api/reports/[jobId]/download        → job report PDF
 *   • GET   /api/qa/jobs/[id]/report             → QA report PDF
 *   • PATCH /api/admin/reports/[jobId]/visibility { clientVisible }
 *   • POST  /api/admin/reports/[jobId]/share      { to }
 */
import { useState } from "react";
import { Download, Eye, EyeOff, FileText, Loader2, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { downloadFromApi } from "@/lib/client/download";

export function ReportActions({
  jobId,
  initialClientVisible,
  initialSentToClient,
  clientEmail,
  hasSubmission = true,
  hasQaReview = true,
}: {
  jobId: string;
  initialClientVisible: boolean;
  initialSentToClient: boolean;
  clientEmail?: string;
  /** False until a checklist has been submitted — gates report download/share/visibility. */
  hasSubmission?: boolean;
  /** False until the job has a QA review — gates the QA report download. */
  hasQaReview?: boolean;
}) {
  const [clientVisible, setClientVisible] = useState(initialClientVisible);
  const [sentToClient, setSentToClient] = useState(initialSentToClient);
  const [downloading, setDownloading] = useState(false);
  const [downloadingQa, setDownloadingQa] = useState(false);
  const [updatingVisibility, setUpdatingVisibility] = useState(false);
  const [sharing, setSharing] = useState(false);

  async function downloadReport() {
    setDownloading(true);
    try {
      await downloadFromApi(`/api/reports/${jobId}/download`, `job-report-${jobId}.pdf`);
    } catch (err: any) {
      toast({
        title: "Download failed",
        description: err?.message ?? "Could not download report.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  async function downloadQaReport() {
    setDownloadingQa(true);
    try {
      await downloadFromApi(`/api/qa/jobs/${jobId}/report`, `qa-report-${jobId}.pdf`);
    } catch (err: any) {
      toast({
        title: "Download failed",
        description: err?.message ?? "Could not download QA report.",
        variant: "destructive",
      });
    } finally {
      setDownloadingQa(false);
    }
  }

  async function toggleVisibility() {
    const next = !clientVisible;
    setUpdatingVisibility(true);
    try {
      const res = await fetch(`/api/admin/reports/${jobId}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientVisible: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update client report visibility.");
      const resolved = typeof body.clientVisible === "boolean" ? body.clientVisible : next;
      setClientVisible(resolved);
      toast({ title: resolved ? "Report visible to client" : "Report hidden from client" });
    } catch (err: any) {
      toast({
        title: "Visibility update failed",
        description: err?.message ?? "Could not update client report visibility.",
        variant: "destructive",
      });
    } finally {
      setUpdatingVisibility(false);
    }
  }

  async function shareReport() {
    const to = (window.prompt("Share report to email:", clientEmail ?? "") ?? "").trim();
    if (!to) return;
    setSharing(true);
    try {
      const res = await fetch(`/api/admin/reports/${jobId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not email report.");
      setSentToClient(true);
      toast({ title: "Report shared", description: `Sent to ${to}` });
    } catch (err: any) {
      toast({
        title: "Share failed",
        description: err?.message ?? "Could not email report.",
        variant: "destructive",
      });
    } finally {
      setSharing(false);
    }
  }

  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
          <FileText className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Report actions
          {sentToClient ? <EBadge tone="success" soft>Shared</EBadge> : null}
        </ECardTitle>
      </ECardHeader>
      <ECardBody className="pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <EButton
            variant="outline"
            size="sm"
            onClick={downloadReport}
            disabled={downloading || !hasSubmission}
            title={!hasSubmission ? "No submitted checklist yet" : undefined}
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {downloading ? "Preparing…" : "Download report"}
          </EButton>
          <EButton
            variant="outline"
            size="sm"
            onClick={downloadQaReport}
            disabled={downloadingQa || !hasQaReview}
            title={!hasQaReview ? "No QA review yet" : undefined}
          >
            {downloadingQa ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            {downloadingQa ? "Preparing…" : "Download QA report"}
          </EButton>
          <EButton
            variant="outline"
            size="sm"
            onClick={toggleVisibility}
            disabled={updatingVisibility || !hasSubmission}
            title={!hasSubmission ? "No submitted checklist yet" : undefined}
          >
            {updatingVisibility ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : clientVisible ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {updatingVisibility ? "Updating…" : clientVisible ? "Hide from client" : "Show to client"}
          </EButton>
          <EButton
            variant="outline"
            size="sm"
            onClick={shareReport}
            disabled={sharing || !hasSubmission}
            title={!hasSubmission ? "No submitted checklist yet" : undefined}
          >
            {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {sharing ? "Sharing…" : "Share to client"}
          </EButton>
        </div>
        {!hasSubmission ? (
          <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Report actions unlock once the cleaner submits their checklist.
          </p>
        ) : null}
      </ECardBody>
    </ECard>
  );
}
