"use client";

/**
 * Office amendments on the cleaner invoice review page (2026-11-23):
 * - "Amended by the office": every amendment, newest first, with who (the
 *   actual person and their role), when (organisation timezone), the reason,
 *   each change, the totals and what happened to the payee's notice;
 * - the loud "needs updating in Xero" notice for an amended invoice that is
 *   already a Xero bill, with "I've updated the bill in Xero" (a recorded,
 *   audited statement: nothing is sent to Xero).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneCard, EToneNotice } from "@/components/v2/ui/tone-band";
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import type { CleanerInvoiceReview } from "@/lib/cleaner/invoice-review";
import { aud, stamp } from "../../pay-records/format";
import { MUTED, SMALL } from "../../pay-records/record-parts";
import { noticeText } from "./amend-invoice-panel";

const ROLE_LABEL: Record<string, string> = { ADMIN: "administrator", OPS_MANAGER: "operations manager" };

export function AmendmentsCard({ review }: { review: CleanerInvoiceReview }) {
  const amendments = review.amendments;
  if (!amendments) return null;
  if ("error" in amendments) {
    return <p role="alert" className={cn(SMALL, "text-[hsl(var(--e-danger))]")}>The amendments could not be read: {amendments.error}</p>;
  }
  return (
    <EToneCard tone="attention" header={<b>Amended by the office</b>} pill={`${amendments.amendments.length} amendment${amendments.amendments.length === 1 ? "" : "s"}`}>
      <p className={SMALL}>
        Submitted total <b className="e-tnum">{aud(amendments.originalTotal)}</b> · amended total <b className="e-tnum">{aud(review.row.totalAmount)}</b>. The payee&apos;s original submission and every amendment are kept.
      </p>
      <ol className="mt-2 space-y-3">
        {amendments.amendments.map((amendment) => (
          <li key={amendment.revision} className="border-t border-[hsl(var(--e-border))] pt-2">
            <p className={cn(SMALL, "font-[600]")}>
              Amendment {amendment.revision} · {stamp(amendment.at, review.timezone)} · {amendment.actorName ?? "Office"} ({ROLE_LABEL[amendment.actorRole] ?? amendment.actorRole})
            </p>
            <ul className={cn(SMALL, "mt-1 list-disc pl-5")}>
              {amendment.changes.map((change) => <li key={change}>{change}</li>)}
            </ul>
            <p className={cn(SMALL, "mt-1")}>Reason: {amendment.reason}</p>
            {amendment.note ? <p className={cn(SMALL, MUTED)}>Note on the invoice: {amendment.note}</p> : null}
            <p className={cn("mt-1 text-[0.75rem]", MUTED)}>Payee told: {noticeText(amendment.notice)}</p>
          </li>
        ))}
      </ol>
    </EToneCard>
  );
}

type MarkState = { status: "idle" } | { status: "saving" } | { status: "error"; message: string };

export function XeroOutOfDateNotice({ review, readOnly }: { review: CleanerInvoiceReview; readOnly: boolean }) {
  const router = useRouter();
  const { row } = review;
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [state, setState] = React.useState<MarkState>({ status: "idle" });
  if (!row.xeroOutOfDateSince) return null;
  const saving = state.status === "saving";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (note.trim().length < 3 || saving) return;
    setState({ status: "saving" });
    try {
      const response = await fetch(`/api/admin/cleaner-invoices/${encodeURIComponent(row.id)}/xero-updated`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: row.updatedAt, note: note.trim() }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setState({ status: "error", message: body?.error ?? "Nothing was recorded." });
        return;
      }
      setState({ status: "idle" });
      router.refresh();
    } catch {
      setState({ status: "error", message: "No answer from the server. Nothing may have been recorded; reload to see." });
    }
  }

  return (
    <EToneNotice tone="problem" title="Needs updating in Xero">
      <p>
        This invoice was amended after it was pushed to Xero ({stamp(row.xeroOutOfDateSince, review.timezone)}). The bill in Xero still shows the earlier lines; the amended total here is {aud(row.totalAmount)}. Update the bill in Xero by hand: this app cannot change a bill that is already in Xero, and nothing was sent there.
      </p>
      {readOnly ? null : open ? (
        <form onSubmit={submit} className="mt-2 space-y-2">
          <fieldset disabled={saving} className="space-y-2">
            <EField label="What you changed in Xero">
              <EInput value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} className="max-sm:text-[16px]" />
            </EField>
            {state.status === "error" ? <p role="alert" className={cn(SMALL, "text-[hsl(var(--e-danger))]")}>{state.message}</p> : null}
            <div className="flex flex-wrap gap-2">
              <EButton type="submit" size="sm" variant="primary" disabled={note.trim().length < 3 || saving} className="max-sm:h-11">{saving ? "Recording…" : "Record that the Xero bill is updated"}</EButton>
              <EButton type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} className="max-sm:h-11">Cancel</EButton>
            </div>
          </fieldset>
        </form>
      ) : (
        <EButton type="button" size="sm" variant="outline" className="mt-2 max-sm:h-11" onClick={() => setOpen(true)}>I&apos;ve updated the bill in Xero…</EButton>
      )}
    </EToneNotice>
  );
}
