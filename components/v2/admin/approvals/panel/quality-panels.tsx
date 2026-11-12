"use client";

/**
 * Side-panel decisions for quality, laundry and payee claims: QA reworks, QA
 * outcomes, false confirmations (score impact spelled out first), management
 * reviews (adjust score with a reason), payment claims (receipt with the
 * claim), and the two review-and-route queues (continuations, flagged
 * laundry), which only link on as before.
 */
import * as React from "react";
import { ArrowRight, CheckCircle2, Scale, ShieldAlert, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EvidenceThumbs } from "@/components/v2/shared/evidence-thumbs";
import { money } from "@/lib/admin/approvals/rows";
import { ConfirmButton, ContextLinks, DetailList, PanelNote, PanelSection, formatDay, formatInstant, jobHref, type QueuePanelProps } from "./panel-kit";

const FIELD =
  "w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem] " +
  "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

export function QaReworkPanel({ row, busy, decide }: QueuePanelProps) {
  const record = row.record;
  const url = `/api/admin/qa/rework-transfers/${record.id}`;
  const areas = Array.isArray(record.areas) ? (record.areas as string[]) : [];
  return (
    <>
      <PanelSection title="What was asked">
        <DetailList
          items={[
            ["Transfer", `${record.cleaner?.name ?? "Cleaner"} → ${record.qaUser?.name ?? "QA inspector"}`],
            ["Proposed", `${record.minutesFromCleaner ?? 0} min · ${money(Number(record.amountFromCleaner ?? 0))}`],
            record.severity ? ["Severity", record.severity] : null,
            record.affectsCleanerStats ? ["Stats", "Affects the cleaner's stats"] : null,
            record.reason ? ["Reason", record.reason] : null,
            areas.length ? ["Areas", areas.join(", ")] : null,
          ]}
        />
        <ContextLinks links={[jobHref(row) ? { href: jobHref(row)!, label: "View job" } : null]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy} className="flex flex-wrap gap-2">
          <EButton size="sm" variant="gold" onClick={() => void decide({ url, body: { status: "APPROVED" }, successMsg: "Rework approved — time and pay moved to QA" })}>
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Approve
          </EButton>
          <ConfirmButton label={<><XCircle aria-hidden className="h-3.5 w-3.5" /> Reject</>} confirmLabel="Confirm reject" onConfirm={() => void decide({ url, body: { status: "REJECTED" }, successMsg: "Rework rejected" })} />
        </fieldset>
      </PanelSection>
    </>
  );
}

export function QaOutcomePanel({ row, busy, decide, timezone }: QueuePanelProps) {
  const record = row.record;
  const review = record.review;
  return (
    <>
      <PanelSection title="What was found">
        <DetailList
          items={[
            ["Job", `J-${record.jobNumber ?? "—"} · ${formatDay(record.scheduledDate)}`],
            ["Cleaner", record.cleaners?.length ? record.cleaners.join(", ") : "—"],
            review ? ["Result", `${review.passed ? "Passed" : "Failed"} · ${Number(review.score ?? 0).toFixed(0)}% · ${review.kind === "QA" ? "Inspection" : "Admin score"}`] : null,
            review?.cleanerAcknowledgedAt ? ["Cleaner", "Seen by the cleaner"] : null,
            record.openRework ? ["Rework", "Rework in progress"] : null,
            review?.createdAt ? ["Scored", formatInstant(review.createdAt, timezone)] : null,
          ]}
        />
        <ContextLinks links={[{ href: `/v2/admin/jobs/${record.id}`, label: "View job" }]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy}>
          <EButton size="sm" variant="gold" onClick={() => void decide({ url: "/api/admin/qa/outcomes", method: "POST", body: { jobIds: [record.id] }, successMsg: "Job marked completed" })}>
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Approve — mark completed
          </EButton>
        </fieldset>
        <PanelNote>Marks the job completed so it can be invoiced. QA scores and any rework jobs are unaffected.</PanelNote>
      </PanelSection>
    </>
  );
}

export function FalseConfirmationPanel({ row, busy, decide }: QueuePanelProps) {
  const record = row.record;
  const [pending, setPending] = React.useState<null | "CONFIRMED" | "REJECTED">(null);
  const run = (decision: "CONFIRMED" | "REJECTED") =>
    decide({
      url: `/api/admin/qa/issues/${record.id}`,
      body: { action: "falseConfirmation", decision },
      successMsg: decision === "CONFIRMED" ? "False confirmation confirmed — penalty kept" : "False confirmation rejected — penalty reversed",
    });
  return (
    <>
      <PanelSection title="What was found">
        <DetailList
          items={[
            ["Cleaner", record.cleaner?.name ?? record.cleaner?.email ?? "Cleaner"],
            ["Severity", record.severity ?? "—"],
            record.category ? ["Category", record.category] : null,
            record.description ? ["Detail", record.description] : null,
            record.cleanerMarkedComplete ? ["Checklist", "The cleaner marked this item complete."] : null,
          ]}
        />
        <ContextLinks links={[jobHref(row) ? { href: jobHref(row)!, label: "View job" } : null]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy} className="flex flex-wrap gap-2">
          <EButton size="sm" variant="danger" onClick={() => setPending("CONFIRMED")}><ShieldAlert aria-hidden className="h-3.5 w-3.5" /> Confirm</EButton>
          <EButton size="sm" variant="outline" onClick={() => setPending("REJECTED")}><XCircle aria-hidden className="h-3.5 w-3.5" /> Reject</EButton>
        </fieldset>
      </PanelSection>
      <EActionDialog
        open={pending !== null}
        eyebrow="False confirmation"
        title={pending === "CONFIRMED" ? "Confirm false confirmation" : "Reject false confirmation"}
        busy={busy}
        onClose={() => setPending(null)}
        footer={
          <>
            <EButton size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</EButton>
            <EButton size="sm" variant={pending === "CONFIRMED" ? "danger" : "gold"} onClick={() => { const decision = pending; setPending(null); if (decision) void run(decision); }}>
              {pending === "CONFIRMED" ? "Confirm penalty" : "Reject — reverse penalty"}
            </EButton>
          </>
        }
      >
        <p>
          {pending === "CONFIRMED"
            ? "Confirming keeps the extra −10 score penalty applied to this clean and marks the false completion as confirmed."
            : "Rejecting reverses the extra −10 score penalty — the cleaner is cleared of a false completion for this item."}
        </p>
      </EActionDialog>
    </>
  );
}

export function ManagementReviewPanel({ row, busy, decide }: QueuePanelProps) {
  const record = row.record;
  const [score, setScore] = React.useState(record.score != null ? String(record.score) : "");
  const [reason, setReason] = React.useState("");
  const ids = React.useId();
  function submit() {
    const value = Number(score);
    if (!Number.isFinite(value) || value < 0 || value > 100) return toast({ title: "Enter a score from 0 to 100", variant: "destructive" });
    if (!reason.trim()) return toast({ title: "A reason is required to adjust the score.", variant: "destructive" });
    if (!record.jobId) return toast({ title: "This review has no linked job.", variant: "destructive" });
    void decide({ url: `/api/admin/jobs/${record.jobId}/qa/adjust`, method: "POST", body: { reviewId: record.id, score: value, reason: reason.trim() }, successMsg: "Score adjusted" });
  }
  return (
    <>
      <PanelSection title="What was found">
        <DetailList
          items={[
            ["Cleaner", record.cleaner?.name ?? "—"],
            ["Score", record.score != null ? `${Number(record.score).toFixed(0)}%` : "—"],
            record.rawScore != null && record.rawScore !== record.score ? ["Raw score", `${Number(record.rawScore).toFixed(0)}%`] : null,
          ]}
        />
        <ContextLinks links={[jobHref(row) ? { href: jobHref(row)!, label: "QA detail" } : null]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy} className="flex flex-col gap-2">
          <label htmlFor={`${ids}-score`} className="text-[0.75rem] font-[550]">Score (0–100)</label>
          <input id={`${ids}-score`} className={FIELD + " h-10"} type="number" inputMode="numeric" min="0" max="100" value={score} onChange={(e) => setScore(e.target.value)} />
          <label htmlFor={`${ids}-reason`} className="text-[0.75rem] font-[550]">Reason (required)</label>
          <textarea id={`${ids}-reason`} className={FIELD + " py-2"} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <EButton size="sm" variant="gold" onClick={submit}><Scale aria-hidden className="h-3.5 w-3.5" /> Save adjustment</EButton>
        </fieldset>
        <PanelNote>Sets the final approved score for this clean; the reason is recorded on the review.</PanelNote>
      </PanelSection>
    </>
  );
}

export function PayClaimPanel({ row, busy, decide, timezone }: QueuePanelProps) {
  const record = row.record;
  const url = `/api/admin/cleaner-invoices/${record.id}`;
  return (
    <>
      <PanelSection title="What was claimed">
        <DetailList
          items={[
            ["Payee", record.cleaner?.name ?? record.cleaner?.email ?? "Payee"],
            ["Period", `${formatDay(record.periodStart)} – ${formatDay(record.periodEnd)} · ${record.jobCount ?? 0} job${record.jobCount === 1 ? "" : "s"}`],
            ["Invoiced", money(Number(record.totalAmount ?? 0))],
            typeof record.paidClaimedNote === "string" && record.paidClaimedNote ? ["Note", `“${record.paidClaimedNote}”`] : null,
            ["Claimed", formatInstant(record.paidClaimedAt, timezone)],
          ]}
        />
        {(record.paidClaimedProofUrls?.length ?? 0) > 0 ? (
          <EvidenceThumbs items={record.paidClaimedProofUrls ?? []} alt="Payment proof" docLabel="Open receipt" />
        ) : (
          <PanelNote>No proof of payment was attached.</PanelNote>
        )}
        <ContextLinks links={[{ href: `/v2/admin/finance/cleaner-invoices/${record.id}`, label: "Open invoice" }]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy} className="flex flex-wrap gap-2">
          <EButton size="sm" variant="gold" onClick={() => void decide({ url, body: { status: "PAID", paymentMethod: "BANK_TRANSFER" }, successMsg: "Payment confirmed — invoice marked paid" })}>
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Confirm paid
          </EButton>
          <EButton size="sm" variant="ghost" onClick={() => void decide({ url, body: { status: "SUBMITTED" }, successMsg: "Claim rejected — invoice back with the payee as unpaid" })}>
            <XCircle aria-hidden className="h-3.5 w-3.5" /> Not paid yet
          </EButton>
        </fieldset>
        <PanelNote>Confirming records the payment and stamps the covered jobs; "Not paid yet" keeps the claim on record.</PanelNote>
      </PanelSection>
    </>
  );
}

/** Continuations and flagged laundry: reviewed where the work lives. */
export function ReviewOnlyPanel({ row, timezone }: QueuePanelProps) {
  const record = row.record;
  const laundry = row.queue === "flaggedLaundry";
  return (
    <>
      <PanelSection title={laundry ? "What was flagged" : "What was asked"}>
        <DetailList
          items={[
            ["Job date", formatDay(record.job?.scheduledDate)],
            laundry && typeof record.bagLocation === "string" ? ["Bag location", record.bagLocation] : null,
            laundry && record.notes ? ["Notes", record.notes] : null,
            !laundry && record.reason ? ["Reason", record.reason] : null,
            !laundry && typeof record.preferredDate === "string" ? ["Preferred", formatDay(record.preferredDate)] : null,
            ["Since", formatInstant(row.waitingSince, timezone)],
          ]}
        />
      </PanelSection>
      <PanelSection title="Next step">
        <PanelNote>{laundry ? "Flagged laundry is decided on the Laundry page." : "Continuations are decided on the job."}</PanelNote>
        <div className="flex flex-wrap gap-2">
          <EButton size="sm" variant="outline-gold" asChild>
            <a href={laundry ? "/v2/admin/laundry" : `/v2/admin/jobs/${row.jobId ?? ""}`}>
              {laundry ? "Open laundry" : "Review job"} <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </a>
          </EButton>
          {laundry && row.jobId ? (
            <EButton size="sm" variant="ghost" asChild>
              <a href={`/v2/admin/jobs/${row.jobId}`}>View job</a>
            </EButton>
          ) : null}
        </div>
      </PanelSection>
    </>
  );
}
