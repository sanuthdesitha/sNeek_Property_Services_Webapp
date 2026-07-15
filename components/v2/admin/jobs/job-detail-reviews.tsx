"use client";

/**
 * ESTATE job-detail review surfaces — the interactive pieces of the v2 admin
 * job detail page. Same endpoints and payloads as the v1 console:
 *   · Task requests    PATCH /api/admin/job-tasks/[id]
 *                        { decision: "APPROVE" | "REJECT", note? }
 *   · Continuations    PATCH /api/admin/job-continuations/[id]
 *                        { decision, decisionNote?, newScheduledDate (required
 *                          on APPROVE), previousCleanerHours?, newCleanerHours?,
 *                          transportAllowance? }
 *   · Manage header    mounts the shared JobManageModal (board component) so
 *                        the detail page can reschedule / edit / skip / reset /
 *                        delete without leaving the page.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Check, Settings2, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ETextarea } from "@/components/v2/admin/estate-kit";
import { JobManageModal } from "@/components/v2/admin/jobs/job-manage";
import { AccessMediaGallery } from "@/components/v2/admin/jobs/submission-review";

/* ── Manage trigger (header) ────────────────────────────────────────────── */

export function JobDetailManage({ job }: { job: any }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <EButton variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Settings2 className="h-3.5 w-3.5" /> Manage
      </EButton>
      <JobManageModal
        job={job}
        open={open}
        onClose={() => setOpen(false)}
        onChanged={() => router.refresh()}
      />
    </>
  );
}

/* ── Client task requests ───────────────────────────────────────────────── */

export type TaskRequestRow = {
  id: string;
  title: string;
  description: string | null;
  approvalStatus: string;
  executionStatus: string;
  requiresPhoto: boolean;
  requiresNote: boolean;
  createdAt: string;
  requestedBy: string | null;
  reviewNote: string | null;
  attachments: { id: string; url: string; s3Key: string; label: string | null; mediaType: string }[];
};

function statusWords(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function TaskRequestReviews({ jobId, tasks }: { jobId: string; tasks: TaskRequestRow[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ task: TaskRequestRow; decision: "APPROVE" | "REJECT" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!dialog) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/job-tasks/${dialog.task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: dialog.decision, note: note.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not review this request.");
      toast({ title: dialog.decision === "APPROVE" ? "Task request approved" : "Task request rejected" });
      setDialog(null);
      setNote("");
      router.refresh();
    } catch (err: any) {
      toast({ title: "Review failed", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (tasks.length === 0) {
    return (
      <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        No client task requests on this job.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {tasks.map((task) => (
          <div key={task.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[0.8125rem] font-[550]">{task.title}</p>
                {task.description ? (
                  <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{task.description}</p>
                ) : null}
                <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                  Requested by {task.requestedBy ?? "Client"} · {format(new Date(task.createdAt), "dd MMM yyyy HH:mm")}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <EBadge
                  tone={
                    task.approvalStatus === "PENDING_APPROVAL"
                      ? "warning"
                      : task.approvalStatus === "APPROVED"
                        ? "success"
                        : "danger"
                  }
                  soft
                >
                  {statusWords(task.approvalStatus)}
                </EBadge>
                <EBadge tone="neutral" soft>{statusWords(task.executionStatus)}</EBadge>
                {task.requiresPhoto ? <EBadge tone="info" soft>Photo proof</EBadge> : null}
                {task.requiresNote ? <EBadge tone="info" soft>Cleaner note</EBadge> : null}
              </div>
            </div>
            {task.attachments.length > 0 ? (
              <div className="mt-2">
                <AccessMediaGallery
                  media={task.attachments}
                  jobId={jobId}
                  title="Client reference"
                  className="grid grid-cols-4 gap-2 sm:grid-cols-6"
                />
              </div>
            ) : null}
            {task.reviewNote ? (
              <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Review note: {task.reviewNote}</p>
            ) : null}
            {task.approvalStatus === "PENDING_APPROVAL" ? (
              <div className="mt-3 flex gap-2">
                <EButton
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setNote("");
                    setDialog({ task, decision: "APPROVE" });
                  }}
                >
                  <Check className="h-3.5 w-3.5" /> Approve
                </EButton>
                <EButton
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNote("");
                    setDialog({ task, decision: "REJECT" });
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Reject
                </EButton>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <EModal
        open={!!dialog}
        onClose={() => {
          if (!busy) setDialog(null);
        }}
        title={dialog?.decision === "APPROVE" ? "Approve task request" : "Reject task request"}
        eyebrow="Client requests"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{dialog?.task.title}</p>
          <EField label="Note" hint="Optional — shared with the client alongside the decision.">
            <ETextarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={dialog?.decision === "APPROVE" ? "Any conditions or context" : "Why is this being declined?"}
            />
          </EField>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" onClick={() => setDialog(null)} disabled={busy}>Cancel</EButton>
            <EButton
              variant={dialog?.decision === "APPROVE" ? "gold" : "danger"}
              onClick={submit}
              disabled={busy}
            >
              {busy ? "Saving…" : dialog?.decision === "APPROVE" ? "Approve request" : "Reject request"}
            </EButton>
          </div>
        </div>
      </EModal>
    </>
  );
}

/* ── Continuation / reschedule decisions ────────────────────────────────── */

export type JobContinuationRow = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string;
  requestedAt: string;
  requestedBy: string;
  preferredDate: string | null;
  estimatedRemainingHours: number | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  continuationJobId: string | null;
  loggedCleaners: { cleanerName: string; minutes: number }[];
};

export function JobContinuationReviews({ requests }: { requests: JobContinuationRow[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ request: JobContinuationRow; decision: "APPROVE" | "REJECT" } | null>(null);
  const [form, setForm] = useState({
    newScheduledDate: "",
    decisionNote: "",
    previousCleanerHours: "",
    newCleanerHours: "",
    transportAllowance: "",
  });
  const [busy, setBusy] = useState(false);

  function openDialog(request: JobContinuationRow, decision: "APPROVE" | "REJECT") {
    setForm({
      newScheduledDate: request.preferredDate ?? "",
      decisionNote: "",
      previousCleanerHours: "",
      newCleanerHours: request.estimatedRemainingHours != null ? String(request.estimatedRemainingHours) : "",
      transportAllowance: "",
    });
    setDialog({ request, decision });
  }

  async function submit() {
    if (!dialog) return;
    if (dialog.decision === "APPROVE" && !form.newScheduledDate) {
      toast({ title: "Continuation date required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        decision: dialog.decision,
        decisionNote: form.decisionNote.trim() || undefined,
      };
      if (dialog.decision === "APPROVE") {
        payload.newScheduledDate = form.newScheduledDate;
        if (form.previousCleanerHours.trim() !== "") payload.previousCleanerHours = Number(form.previousCleanerHours);
        if (form.newCleanerHours.trim() !== "") payload.newCleanerHours = Number(form.newCleanerHours);
        if (form.transportAllowance.trim() !== "") payload.transportAllowance = Number(form.transportAllowance);
      }
      const res = await fetch(`/api/admin/job-continuations/${dialog.request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update the continuation request.");
      toast({ title: dialog.decision === "APPROVE" ? "Continuation approved" : "Continuation rejected" });
      setDialog(null);
      router.refresh();
    } catch (err: any) {
      toast({ title: "Decision failed", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (requests.length === 0) {
    return (
      <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        No continuation requests for this job.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {requests.map((row) => (
          <div key={row.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[0.8125rem] font-[550]">{row.requestedBy}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Requested {format(new Date(row.requestedAt), "dd MMM yyyy HH:mm")}
                </p>
              </div>
              <EBadge tone={row.status === "PENDING" ? "warning" : row.status === "APPROVED" ? "success" : "neutral"} soft>
                {statusWords(row.status)}
              </EBadge>
            </div>
            {row.reason ? (
              <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{row.reason}</p>
            ) : null}
            <div className="mt-2 grid gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:grid-cols-3">
              <p>Preferred date: {row.preferredDate ?? "—"}</p>
              <p>Remaining hours: {row.estimatedRemainingHours ?? "—"}</p>
              <p>
                Logged so far:{" "}
                {row.loggedCleaners.length > 0
                  ? row.loggedCleaners.map((c) => `${c.cleanerName} ${Math.round(c.minutes)}m`).join(", ")
                  : "—"}
              </p>
            </div>
            {row.status !== "PENDING" ? (
              <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                {row.status === "APPROVED" ? "Approved" : "Rejected"}
                {row.decidedBy ? ` by ${row.decidedBy}` : ""}
                {row.decidedAt ? ` · ${format(new Date(row.decidedAt), "dd MMM yyyy HH:mm")}` : ""}
                {row.decisionNote ? ` · ${row.decisionNote}` : ""}
                {row.status === "APPROVED" && row.continuationJobId ? ` · Continuation job ${row.continuationJobId}` : ""}
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <EButton variant="primary" size="sm" onClick={() => openDialog(row, "APPROVE")}>
                  <Check className="h-3.5 w-3.5" /> Approve &amp; schedule
                </EButton>
                <EButton variant="outline" size="sm" onClick={() => openDialog(row, "REJECT")}>
                  <X className="h-3.5 w-3.5" /> Reject
                </EButton>
              </div>
            )}
          </div>
        ))}
      </div>

      <EModal
        open={!!dialog}
        onClose={() => {
          if (!busy) setDialog(null);
        }}
        title={dialog?.decision === "APPROVE" ? "Approve continuation request" : "Reject continuation request"}
        eyebrow="Continuations"
        size="wide"
      >
        <div className="space-y-4">
          {dialog?.decision === "APPROVE" ? (
            <>
              <EField label="Continuation date" hint="A follow-on job is scheduled on this date.">
                <EInput
                  type="date"
                  value={form.newScheduledDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, newScheduledDate: e.target.value }))}
                />
              </EField>
              <div className="grid gap-4 sm:grid-cols-3">
                <EField label="Previous cleaner hours" hint="Optional payout override.">
                  <EInput
                    type="number"
                    min="0"
                    step="0.25"
                    value={form.previousCleanerHours}
                    onChange={(e) => setForm((prev) => ({ ...prev, previousCleanerHours: e.target.value }))}
                    placeholder="From timer"
                  />
                </EField>
                <EField label="Continuation hours" hint="Allocated to the follow-on job.">
                  <EInput
                    type="number"
                    min="0"
                    step="0.25"
                    value={form.newCleanerHours}
                    onChange={(e) => setForm((prev) => ({ ...prev, newCleanerHours: e.target.value }))}
                    placeholder="Optional"
                  />
                </EField>
                <EField label="Transport allowance (AUD)">
                  <EInput
                    type="number"
                    min="0"
                    step="0.5"
                    value={form.transportAllowance}
                    onChange={(e) => setForm((prev) => ({ ...prev, transportAllowance: e.target.value }))}
                    placeholder="Optional"
                  />
                </EField>
              </div>
            </>
          ) : null}
          <EField label="Decision note" hint="Optional — sent to the requesting cleaner.">
            <ETextarea
              value={form.decisionNote}
              onChange={(e) => setForm((prev) => ({ ...prev, decisionNote: e.target.value }))}
              placeholder={dialog?.decision === "APPROVE" ? "Any conditions or context" : "Why is this being declined?"}
            />
          </EField>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" onClick={() => setDialog(null)} disabled={busy}>Cancel</EButton>
            <EButton
              variant={dialog?.decision === "APPROVE" ? "gold" : "danger"}
              onClick={submit}
              disabled={busy || (dialog?.decision === "APPROVE" && !form.newScheduledDate)}
            >
              {busy ? "Saving…" : dialog?.decision === "APPROVE" ? "Approve request" : "Reject request"}
            </EButton>
          </div>
        </div>
      </EModal>
    </>
  );
}
