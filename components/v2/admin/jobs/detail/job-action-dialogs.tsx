"use client";

/**
 * The dialogs the job page's "More" menu opens. Each one is an existing
 * editor or dialog: the inline manage editor's sections (same PATCH routes,
 * stale-write token and confirmations), the reminder, reset and cancel
 * dialogs, and delete with the PIN-or-password confirmation.
 *
 * Delete now returns to the jobs board after success; it used to refresh the
 * page of a job that no longer existed (a 404).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { EConfirmModal, EModal } from "@/components/v2/admin/estate-kit";
import type { JobPageManageJob } from "@/lib/jobs/job-page/rows";
import { JobDetailManage } from "../job-detail-reviews";
import type { JobManageSection } from "../job-manage";
import { JobReminderButton } from "../job-reminder-button";
import { JobResetDialog } from "../job-reset-dialog";
import { CancelJobDialog } from "../cancel-job-dialog";

export type JobDialogKey = "scope" | "schedule" | "people" | "skip" | "template" | "reminder" | "reset" | "cancel" | "delete";

const MANAGE_TITLES: Record<Extract<JobDialogKey, JobManageSection>, string> = {
  scope: "Edit job details",
  schedule: "Reschedule or change times",
  people: "Change status, hours and per-cleaner pay",
  skip: "Skip this clean",
  template: "Save job as template",
};

function isManageDialog(key: JobDialogKey): key is Extract<JobDialogKey, JobManageSection> {
  return key in MANAGE_TITLES;
}

export type JobActionDialogsProps = {
  dialog: JobDialogKey | null;
  onClose: () => void;
  jobId: string;
  jobLabel: string;
  statusLabel: string;
  manageJob: JobPageManageJob;
};

type DeleteResponse = { error?: string };

export function JobActionDialogs({ dialog, onClose, jobId, jobLabel, statusLabel, manageJob }: JobActionDialogsProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function deleteJob(credentials?: { pin?: string; password?: string }) {
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = (await response.json().catch(() => ({}))) as DeleteResponse;
      if (!response.ok) throw new Error(body.error ?? "Could not delete job.");
      toast({ title: "Job deleted" });
      onClose();
      router.push("/v2/admin/jobs");
    } catch (error) {
      toast({ title: "Delete failed", description: error instanceof Error ? error.message : "Could not delete job.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {dialog && isManageDialog(dialog) ? (
        <EModal open onClose={onClose} title={MANAGE_TITLES[dialog]} eyebrow={jobLabel} size="wide">
          <JobDetailManage job={manageJob} section={dialog} />
        </EModal>
      ) : null}
      <JobReminderButton jobId={jobId} statusLabel={statusLabel} open={dialog === "reminder"} onOpenChange={(open) => (open ? undefined : onClose())} />
      <JobResetDialog
        open={dialog === "reset"}
        jobId={jobId}
        onClose={onClose}
        onDone={() => {
          toast({ title: "Job reset" });
          router.refresh();
        }}
      />
      <CancelJobDialog open={dialog === "cancel"} jobIds={[jobId]} label={jobLabel} onClose={onClose} onDone={() => router.refresh()} />
      <EConfirmModal
        open={dialog === "delete"}
        onClose={() => (deleting ? undefined : onClose())}
        title="Delete this job?"
        description="This permanently removes the job and its history."
        confirmLabel="Delete job"
        requireSecurity
        loading={deleting}
        onConfirm={deleteJob}
      />
    </>
  );
}
