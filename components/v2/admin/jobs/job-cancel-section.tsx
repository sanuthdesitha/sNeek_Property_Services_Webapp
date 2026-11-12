"use client";

/**
 * The job page's cancel controls (Wave E, 2026-11): "Cancel job" in the job's
 * own Danger section, and the cancelled notice with Restore at the top of the
 * job once it is cancelled. Both refresh the server-rendered page afterwards.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { CancelJobDialog } from "./cancel-job-dialog";
import { RestoreJobControl } from "./restore-job-control";

export function JobCancelButton({ jobId, label, status }: { jobId: string; label: string; status: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const blocked = status === "INVOICED" || status === "CANCELLED";
  return (
    <div className="space-y-2">
      <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
        Cancel this job: it stops being billed, paid, reminded and shown as work, and its cleaners are released. Its history, time and photos are kept, and an unstarted job can be restored.
      </p>
      <EButton variant="danger" size="sm" disabled={blocked} onClick={() => setOpen(true)} title={status === "INVOICED" ? "Invoiced jobs cannot be cancelled." : undefined}>
        Cancel job
      </EButton>
      <CancelJobDialog open={open} jobIds={[jobId]} label={label} onClose={() => setOpen(false)} onDone={() => router.refresh()} />
    </div>
  );
}

export function JobCancelledNotice({ jobId, cancelReason }: { jobId: string; cancelReason: string | null }) {
  const router = useRouter();
  return <RestoreJobControl jobId={jobId} cancelReason={cancelReason} readOnly={false} onRestored={() => router.refresh()} />;
}
