"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Download, FileText, RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { toast } from "@/hooks/use-toast";
import { downloadFromApi } from "@/lib/client/download";

export default function ReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingJobId, setGeneratingJobId] = useState<string | null>(null);
  const [updatingVisibility, setUpdatingVisibility] = useState<string | null>(null);
  const [deletingReport, setDeletingReport] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<any | null>(null);

  async function loadReports() {
    setLoading(true);
    const res = await fetch("/api/admin/reports");
    const data = await res.json().catch(() => []);
    setReports(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => {
    loadReports();
  }, []);

  async function downloadReport(jobId: string) {
    try {
      await downloadFromApi(`/api/reports/${jobId}/download`, `job-report-${jobId}.pdf`);
    } catch (error: any) {
      toast({
        title: "Download failed",
        description: error?.message ?? "Could not export report.",
        variant: "destructive",
      });
    }
  }

  async function regenerateReport(jobId: string) {
    setGeneratingJobId(jobId);
    const res = await fetch(`/api/admin/reports/${jobId}/generate`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setGeneratingJobId(null);
    if (!res.ok) {
      toast({ title: "Generate failed", description: body.error ?? "Could not regenerate report.", variant: "destructive" });
      return;
    }
    toast({ title: "Report regenerated" });
    loadReports();
  }

  async function updateVisibility(
    jobId: string,
    patch: { clientVisible?: boolean; cleanerVisible?: boolean; laundryVisible?: boolean }
  ) {
    setUpdatingVisibility(jobId);
    const res = await fetch(`/api/admin/reports/${jobId}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    setUpdatingVisibility(null);
    if (!res.ok) {
      toast({
        title: "Visibility update failed",
        description: body.error ?? "Could not update report visibility.",
        variant: "destructive",
      });
      return;
    }
    setReports((prev) =>
      prev.map((report) =>
        report.jobId === jobId
          ? {
              ...report,
              ...patch,
              visibilityUpdatedAt: body.visibilityUpdatedAt,
              visibilityUpdatedBy: body.visibilityUpdatedBy,
            }
          : report
      )
    );
  }

  async function deleteReport() {
    if (!reportToDelete) return;
    setDeletingReport(true);
    const res = await fetch(`/api/admin/reports/${reportToDelete.jobId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setDeletingReport(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete report.", variant: "destructive" });
      return;
    }
    toast({ title: "Report deleted" });
    setReportToDelete(null);
    loadReports();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Reports</h2>
          <p className="text-sm text-muted-foreground">{reports.length} generated reports</p>
        </div>
        <Button variant="outline" onClick={loadReports}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading reports...</p>
          ) : (
            <div className="divide-y">
              {reports.map((report) => (
                <div key={report.id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">{report.job?.property?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {report.job?.property?.client?.name} - {report.job?.jobType?.replace(/_/g, " ")} -{" "}
                        {report.job?.scheduledDate ? format(new Date(report.job.scheduledDate), "dd MMM yyyy") : "-"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {report.sentToClient && (
                      <Badge variant="success" className="text-xs">
                        Sent to client
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant={report.clientVisible ? "default" : "outline"}
                      disabled={updatingVisibility === report.jobId}
                      onClick={() => updateVisibility(report.jobId, { clientVisible: !report.clientVisible })}
                    >
                      {report.clientVisible ? "Visible to client" : "Hidden from client"}
                    </Button>
                    <Button
                      size="sm"
                      variant={report.cleanerVisible ? "outline" : "secondary"}
                      disabled={updatingVisibility === report.jobId}
                      onClick={() => updateVisibility(report.jobId, { cleanerVisible: !report.cleanerVisible })}
                    >
                      {report.cleanerVisible ? "Cleaner visible" : "Cleaner hidden"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadReport(report.jobId)}>
                      <Download className="mr-1 h-4 w-4" />
                      PDF
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={generatingJobId === report.jobId}
                      onClick={() => regenerateReport(report.jobId)}
                    >
                      <RefreshCcw className="mr-1 h-4 w-4" />
                      {generatingJobId === report.jobId ? "Generating..." : "Regenerate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setReportToDelete(report)}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
              {reports.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No reports yet. Reports are generated after cleaner submissions.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <TwoStepConfirmDialog
        open={Boolean(reportToDelete)}
        onOpenChange={(open) => !open && setReportToDelete(null)}
        title="Delete report"
        description="This removes the generated report file and metadata for this job."
        confirmLabel="Delete report"
        loading={deletingReport}
        onConfirm={deleteReport}
      />
    </div>
  );
}
