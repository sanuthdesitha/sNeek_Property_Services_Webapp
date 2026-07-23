"use client";

/**
 * Admin / ops quick QA review — score a submitted job without the full on-site
 * QA inspection. Native Estate, same endpoint as v1:
 *   POST /api/admin/jobs/[id]/qa  { score, notes?, flags? }
 * Server sets pass/fail by the configured threshold (pass → COMPLETED, fail →
 * QA_REVIEW) and records the review as kind "ADMIN" (a real on-site QA outranks).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EModal, EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";

// Statuses the QA endpoint accepts (others 409). Mirrors QA_REVIEWABLE server-side.
const REVIEWABLE = new Set(["SUBMITTED", "QA_REVIEW", "COMPLETED"]);

export function QuickQaReview({
  jobId,
  jobStatus,
  hasReview,
  defaultScore = 90,
}: {
  jobId: string;
  jobStatus: string;
  hasReview?: boolean;
  defaultScore?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(String(defaultScore));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const reviewable = REVIEWABLE.has(jobStatus);

  async function offerRework(prompt: {
    score: number;
    threshold: number;
    inspectorReviewed: boolean;
    inspectorRequestedRework: boolean;
    existingReworkJobId: string | null;
  }) {
    if (prompt.existingReworkJobId) {
      toast({
        title: "Rework already scheduled",
        description: "This job already has a rework job — no second one was created.",
      });
      return;
    }
    const inspectorLine = prompt.inspectorRequestedRework
      ? "The QA inspector asked for a rework on this job."
      : prompt.inspectorReviewed
        ? "The QA inspector inspected this job and did NOT ask for a rework."
        : "No QA inspector has inspected this job.";
    const ok = window.confirm(
      `Scored ${Math.round(prompt.score)}%, below the ${prompt.threshold}% threshold.\n\n` +
        `${inspectorLine}\n\n` +
        `Create a rework job? This schedules a real job, assigns a cleaner, and emails the client twice — telling them an issue was found and when the re-clean is booked.`,
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/qa/rework`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create the rework job.");
      toast({
        title: body.created ? "Rework job created" : "No rework created",
        description: body.created
          ? "The client has been emailed and a cleaner assigned where possible."
          : (body.message ?? "A rework job already existed."),
      });
    } catch (err: any) {
      toast({
        title: "Rework failed",
        description: err?.message ?? "Could not create the rework job.",
        variant: "destructive",
      });
    }
  }

  async function submit() {
    const n = Number(score);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      toast({ title: "Enter a score from 0 to 100", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: n, notes: notes.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "QA review failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({
        title: "QA review submitted",
        description: `Score ${n} · ${body.passed === false ? "below threshold" : "passed"}`,
      });
      setOpen(false);

      // A low score no longer creates a rework job by itself — that schedules a
      // real job and emails the client twice, which is not something a typed
      // number should do on its own. The server returns the facts; we ask.
      if (body?.reworkPrompt) {
        await offerRework(body.reworkPrompt);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!reviewable) {
    return (
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Quick QA review is available once the job is submitted.
      </p>
    );
  }

  return (
    <>
      <EButton variant={hasReview ? "outline" : "gold"} size="sm" onClick={() => setOpen(true)}>
        <ShieldCheck className="h-3.5 w-3.5" /> {hasReview ? "Re-review" : "Quick QA review"}
      </EButton>

      {open ? (
        <EModal open onClose={() => setOpen(false)} size="md" eyebrow="Quality" title="Quick QA review">
          <div className="space-y-4">
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Score this job. A pass marks it complete; below the QA threshold it goes to rework.
              Recorded as an admin review — a real on-site QA inspection outranks it.
            </p>
            <EField label="Score (0–100)">
              <EInput
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                value={score}
                onChange={(e) => setScore(e.target.value)}
              />
            </EField>
            <EField label="Notes (optional)">
              <ETextarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What you checked, any issues…"
              />
            </EField>
            <div className="flex justify-end gap-2 pt-1">
              <EButton variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </EButton>
              <EButton variant="gold" onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Submit review
              </EButton>
            </div>
          </div>
        </EModal>
      ) : null}
    </>
  );
}
