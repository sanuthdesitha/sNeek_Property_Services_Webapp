"use client";

/**
 * Read-only sections of the cleaner invoice review page: lines from the
 * submitted snapshot, the change note, the payment record and claim (with the
 * proof thumbnails), the submitted-vs-expected comparison and the history.
 * Moved from the old "View lines" modal and extended.
 */
import { formatInTimeZone } from "date-fns-tz";
import { ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import { EvidenceThumbs } from "@/components/v2/shared/evidence-thumbs";
import type { CleanerInvoiceReview } from "@/lib/cleaner/invoice-review";
import { SubmissionBlock } from "../expected-invoice-cards";
import { CLEANER_PAY_METHOD_LABEL, fmtDay, fmtStamp, money, type CleanerRow } from "../cleaner-invoice-model";

const MUTED = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

type LineRow = { label?: string; description?: string; hours?: number; rate?: number; amount?: number; unitAmount?: number; quantity?: number; jobNumber?: string };

function linesOf(lineData: unknown): LineRow[] {
  const data = lineData as { lines?: unknown } | unknown[] | null;
  if (Array.isArray(data)) return data as LineRow[];
  return Array.isArray((data as { lines?: unknown } | null)?.lines) ? ((data as { lines: LineRow[] }).lines) : [];
}

export function LinesCard({ row }: { row: CleanerRow }) {
  const lines = linesOf(row.lineData);
  return (
    <ECard className="space-y-3 px-4 py-3.5">
      <EEyebrow>Lines as submitted</EEyebrow>
      {lines.length ? (
        <ETableShell headers={[{ label: "Description" }, { label: "Hours" }, { label: "Rate" }, { label: "Amount", align: "right" }]}>
          {lines.map((line, index) => (
            <tr key={index} className="border-t border-[hsl(var(--e-border))]">
              <td className="px-4 py-2 text-[0.8125rem]">{line.description ?? line.label ?? line.jobNumber ?? "Line"}</td>
              <td className="px-4 py-2 text-[0.8125rem]">{line.hours != null ? Number(line.hours).toFixed(2) : "—"}</td>
              <td className="px-4 py-2 text-[0.8125rem]">{line.rate != null ? money(line.rate) : "—"}</td>
              <td className="px-4 py-2 text-right text-[0.8125rem]">
                {line.amount != null ? money(line.amount) : line.unitAmount != null ? money(line.unitAmount * (line.quantity ?? 1)) : "—"}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-[hsl(var(--e-border-strong))]">
            <td colSpan={3} className="px-4 py-2 text-[0.8125rem] font-[600]">Total (stored)</td>
            <td className="px-4 py-2 text-right text-[0.8125rem] font-[600]">{money(row.totalAmount)}</td>
          </tr>
        </ETableShell>
      ) : (
        <p className={MUTED}>No line snapshot stored for this submission. Total {money(row.totalAmount)}.</p>
      )}
    </ECard>
  );
}

export function NotesCard({ row }: { row: CleanerRow }) {
  const blocks: React.ReactNode[] = [];
  if (row.status === "CHANGES_REQUESTED") {
    blocks.push(
      <div key="changes" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.45)] bg-[hsl(var(--e-warning)/0.08)] p-3 text-[0.8125rem]">
        <p className="mb-1 font-medium text-[hsl(var(--e-warning))]">Sent back for changes <span className="ml-2 font-normal text-[hsl(var(--e-muted-foreground))]">{fmtStamp(row.changesRequestedAt)}</span></p>
        <p className="whitespace-pre-wrap text-[hsl(var(--e-text-secondary))]">{row.changesRequestedNote || "No reason recorded."}</p>
        <p className={`mt-1.5 ${MUTED}`}>Everything on it was released, so the payee can rebuild the invoice for this period and resend it as a new submission.</p>
      </div>,
    );
  }
  if (row.status === "PAID") {
    blocks.push(
      <div key="paid" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-success)/0.35)] bg-[hsl(var(--e-success)/0.06)] p-3 text-[0.8125rem]">
        <p className="mb-1 font-medium text-[hsl(var(--e-success))]">Payment recorded</p>
        <div className="flex flex-wrap gap-4">
          <span>Amount paid: {money(row.paidAmount ?? row.totalAmount)}</span>
          {row.paymentMethod ? <span>Method: {CLEANER_PAY_METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod}</span> : null}
          {row.paidBankAccount ? <span>Bank account: {row.paidBankAccount}</span> : null}
          {row.paidDate ? <span>Paid on: {fmtDay(row.paidDate)}</span> : null}
          {row.paidAt ? <span>Recorded: {fmtStamp(row.paidAt)}</span> : null}
        </div>
        {row.paidNote ? <p className={`mt-1.5 ${MUTED}`}>Comments: {row.paidNote}</p> : null}
      </div>,
    );
  }
  if (row.paidClaimedAt) {
    blocks.push(
      <div key="claim" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
        <p className="mb-1 font-medium">Payee claimed payment <span className="ml-2 font-normal text-[hsl(var(--e-muted-foreground))]">{fmtStamp(row.paidClaimedAt)}</span></p>
        {row.paidClaimedNote ? <p className="mb-2 text-[hsl(var(--e-muted-foreground))]">“{row.paidClaimedNote}”</p> : null}
        {row.paidClaimedProofUrls.length ? (
          <>
            <p className={`mb-1.5 ${MUTED}`}>Proof attached ({row.paidClaimedProofUrls.length})</p>
            <EvidenceThumbs items={row.paidClaimedProofUrls} alt="Payment proof" docLabel="Open receipt" />
          </>
        ) : (
          <p className={MUTED}>No proof attached.</p>
        )}
      </div>,
    );
  }
  if (!blocks.length) return null;
  return <section aria-label="Notes and payment" className="space-y-2.5">{blocks}</section>;
}

export function ComparisonCard({ comparison }: { comparison: CleanerInvoiceReview["comparison"] }) {
  return (
    <ECard className="space-y-2.5 px-4 py-3.5">
      <EEyebrow>Submitted vs expected</EEyebrow>
      {comparison.status === "not-applicable" ? <p className={MUTED}>{comparison.reason}</p> : null}
      {comparison.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">The comparison could not be computed: {comparison.message}</p> : null}
      {comparison.status === "ready" ? (
        comparison.expected ? (
          <>
            <p className="text-[0.8125rem]">
              Current forecast for this payee, {fmtDay(`${comparison.start}T12:00:00Z`)} – {fmtDay(`${comparison.end}T12:00:00Z`)}:{" "}
              <span className="e-tnum font-[600]">{money(comparison.expected.expectedTotal)}</span> ({comparison.expected.jobCount} jobs)
              {comparison.expected.rateMissingCount ? `, ${comparison.expected.rateMissingCount} with no rate (understated)` : ""}.
            </p>
            <SubmissionBlock submission={comparison.expected.submission} />
            <p className={MUTED}>The forecast is today&apos;s unpaid work for the period, not a snapshot of what was submitted.</p>
          </>
        ) : (
          <p className={MUTED}>Nothing unpaid is forecast for this payee in this period.</p>
        )
      ) : null}
    </ECard>
  );
}

export function HistoryCard({ history }: { history: CleanerInvoiceReview["history"] }) {
  return (
    <ECard className="space-y-2.5 px-4 py-3.5">
      <EEyebrow>History</EEyebrow>
      {"error" in history ? (
        <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">History could not be read: {history.error}</p>
      ) : history.length ? (
        <ul className="space-y-1.5">
          {history.map((entry) => (
            <li key={entry.id} className="text-[0.8125rem]">
              <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">{formatInTimeZone(new Date(entry.at), "Australia/Sydney", "d MMM yyyy, HH:mm")}</span>{" "}
              <span className="break-words">{entry.label}</span>
              {entry.actor ? <span className="text-[hsl(var(--e-muted-foreground))]"> by {entry.actor}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={MUTED}>Nothing recorded yet.</p>
      )}
    </ECard>
  );
}
