"use client";

/**
 * "Propose bonus" from a cleaner row: a by-hand quality bonus proposal
 * (POST /api/admin/quality/bonus-proposals). It creates a PENDING pay
 * adjustment that waits in Approvals; nothing is paid until it is approved
 * there. Amount bounds and the required reason come from
 * lib/quality/manual-bonus-rules (the server enforces the same).
 *
 * - The period and cleans it relates to are the row's real figures; the server
 *   re-reads them and records them with the proposal.
 * - A bonus already pending (automatic or manual) is shown as a warning with a
 *   link to review it; proposing another needs an explicit tick, and the server
 *   refuses without it.
 * - Fields freeze while saving; on failure the typed text and the request key
 *   are kept, so "Try again" cannot create a second proposal.
 */
import * as React from "react";
import Link from "next/link";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import {
  APPROVALS_HREF,
  MANUAL_BONUS_MAX_AMOUNT,
  MANUAL_BONUS_MIN_AMOUNT,
  MANUAL_BONUS_REASON_MAX,
  MANUAL_BONUS_REASON_MIN,
  type ManualBonusResult,
  type PendingBonusSummary,
} from "@/lib/quality/manual-bonus-rules";
import { newRequestKey } from "../../office-actions/office-outcomes";
import { formatIssueDate } from "../issues/issue-format";
import type { CleanerRow } from "./hub-types";

type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "failed"; message: string }
  | { status: "done"; result: ManualBonusResult };

type ProposeOutcome =
  | { ok: true; body: ManualBonusResult }
  | { ok: false; status: number; message: string; pending: PendingBonusSummary[] };

const NO_ANSWER = "No answer from the server. Check Approvals before trying again: it may or may not have been proposed.";

/** POST the proposal; a 409 carries the pending bonuses the server found. */
async function postProposal(body: Record<string, unknown>): Promise<ProposeOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/admin/quality/bonus-proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: NO_ANSWER, pending: [] };
  }
  const parsed: unknown = await response.json().catch(() => null);
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  if (response.ok && typeof record.id === "string") return { ok: true, body: parsed as ManualBonusResult };
  const error = typeof record.error === "string" && record.error.trim() && record.error !== "FORBIDDEN" ? record.error : null;
  const pending = Array.isArray(record.pending) ? (record.pending as PendingBonusSummary[]) : [];
  const fallback = response.status === 403 ? "This account is not allowed to propose bonuses." : `The server refused this (${response.status}).`;
  return { ok: false, status: response.status, message: error ?? fallback, pending };
}

export type ProposeBonusDialogProps = {
  row: CleanerRow;
  /** Period and shared filters as serialised for the hub's API reads. */
  apiQuery: string;
  /** "Last 30 days", or null while the period is unknown. */
  periodText: string | null;
  timeZone: string;
  canReview: boolean;
  onClose: () => void;
  onProposed: () => void;
  onReview: () => void;
};

function money(amount: number | null): string {
  return typeof amount === "number" ? `$${amount.toFixed(2)}` : "amount not recorded";
}

function readAmount(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() && Number.isFinite(value) ? value : null;
}

function amountProblem(text: string): string | null {
  const value = readAmount(text);
  if (value === null) return `Enter an amount from $${MANUAL_BONUS_MIN_AMOUNT} to $${MANUAL_BONUS_MAX_AMOUNT}.`;
  if (value < MANUAL_BONUS_MIN_AMOUNT || value > MANUAL_BONUS_MAX_AMOUNT) {
    return `A quality bonus is from $${MANUAL_BONUS_MIN_AMOUNT} to $${MANUAL_BONUS_MAX_AMOUNT}.`;
  }
  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return "Use dollars and cents (two decimals at most).";
  return null;
}

function basisText(row: CleanerRow, periodText: string | null): string {
  const score = row.avgScore === null ? "no reviewed score" : `average score ${Math.round(row.avgScore)}`;
  const streak = row.streak && row.streak.sample > 0 ? `, current streak ${row.streak.currentStreak}` : "";
  const cleans = `${row.cleans} clean${row.cleans === 1 ? "" : "s"}, ${row.reviewed} reviewed`;
  return `${periodText ?? "This period"}: ${cleans}, ${score}${streak}.`;
}

function periodBody(apiQuery: string): { period?: string; from?: string; to?: string } {
  const params = new URLSearchParams(apiQuery);
  const read = (key: string) => params.get(key) || undefined;
  return { period: read("period"), from: read("from"), to: read("to") };
}

export function ProposeBonusDialog({ row, apiQuery, periodText, timeZone, canReview, onClose, onProposed, onReview }: ProposeBonusDialogProps) {
  const ids = { amount: React.useId(), reason: React.useId(), acknowledge: React.useId() };
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [requestKey] = React.useState(() => newRequestKey("quality-bonus"));
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [pending, setPending] = React.useState<PendingBonusSummary[]>(() =>
    row.pendingBonuses.map((bonus) => ({ id: bonus.id, title: bonus.title, amount: bonus.amount, origin: bonus.origin, createdAt: bonus.createdAt })),
  );
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  const [touched, setTouched] = React.useState(false);

  const sending = send.status === "sending";
  const done = send.status === "done";
  const amountError = amountProblem(amount);
  const reasonError = reason.trim().length < MANUAL_BONUS_REASON_MIN ? "A reason is required." : null;
  const needsAcknowledge = pending.length > 0 && !acknowledged;
  const canSubmit = !amountError && !reasonError && !needsAcknowledge && !sending && !done;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    setSend({ status: "sending" });
    const result = await postProposal({
      cleanerId: row.cleanerId,
      amount: readAmount(amount),
      reason: reason.trim(),
      ...periodBody(apiQuery),
      idempotencyKey: requestKey,
      acknowledgePending: pending.length > 0 ? acknowledged : undefined,
    });
    if (result.ok) {
      setSend({ status: "done", result: result.body });
      toast({ title: result.body.duplicate ? "Already proposed" : "Bonus proposed", description: "It waits in Approvals; nothing is paid until it is approved." });
      onProposed();
      return;
    }
    if (result.pending.length > 0) {
      // The server knows of a pending bonus the row did not show yet: show it
      // and ask again rather than proposing a second one silently.
      setPending(result.pending);
      setAcknowledged(false);
    }
    setSend({ status: "failed", message: result.message });
  }

  const formId = `${ids.amount}-form`;
  return (
    <EActionDialog
      open
      busy={sending}
      onClose={onClose}
      eyebrow="Bonus proposal"
      title={`Propose bonus · ${row.name}`}
      description="A proposal only: it waits in Approvals with the other pay requests and is paid only after it is approved there."
      footer={
        done ? (
          <EButton size="sm" onClick={onClose}>Done</EButton>
        ) : (
          <>
            <EButton size="sm" variant="outline" disabled={sending} onClick={onClose}>Cancel</EButton>
            <EButton type="submit" form={formId} size="sm" disabled={sending || (touched && !canSubmit)}>
              {sending ? "Proposing…" : send.status === "failed" ? "Try again" : "Propose bonus"}
            </EButton>
          </>
        )
      }
    >
      {done ? (
        <div role="status" className="space-y-2">
          <p>{send.result.duplicate ? "This bonus was already proposed; nothing new was created." : "Bonus proposed. It waits for approval."}</p>
          <EButton asChild size="sm" variant="outline"><Link href={send.result.approvalsHref || APPROVALS_HREF}>Open Approvals</Link></EButton>
        </div>
      ) : (
        <form id={formId} noValidate onSubmit={(event) => void submit(event)} className="space-y-3">
          <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
            <span className="font-[600]">Relates to </span>
            {basisText(row, periodText)}
          </p>
          {pending.length > 0 ? (
            <div role="alert" className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.5)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">
              <p className="font-[600]">{`A bonus is already waiting for a decision for ${row.name}.`}</p>
              <ul className="list-disc pl-5">
                {pending.map((bonus) => (
                  <li key={bonus.id}>
                    {`${bonus.title} · ${money(bonus.amount)} · ${bonus.origin === "automatic" ? "proposed automatically" : "proposed by hand"} ${formatIssueDate(bonus.createdAt, timeZone)}`}
                  </li>
                ))}
              </ul>
              {canReview ? (
                <button type="button" className="font-[600] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline" disabled={sending} onClick={onReview}>
                  Review it
                </button>
              ) : (
                <Link href={APPROVALS_HREF} className="font-[600] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">Review it in Approvals</Link>
              )}
              <label htmlFor={ids.acknowledge} className="flex items-start gap-2">
                <input id={ids.acknowledge} type="checkbox" className="mt-0.5 h-4 w-4" checked={acknowledged} disabled={sending} onChange={(event) => setAcknowledged(event.target.checked)} />
                <span>Propose another bonus anyway</span>
              </label>
            </div>
          ) : null}
          <fieldset disabled={sending} className="space-y-3">
            <legend className="sr-only">Bonus details</legend>
            <EField label="Amount (AUD)" hint={`From $${MANUAL_BONUS_MIN_AMOUNT} to $${MANUAL_BONUS_MAX_AMOUNT}.`}>
              <EInput
                id={ids.amount}
                type="number"
                inputMode="decimal"
                min={MANUAL_BONUS_MIN_AMOUNT}
                max={MANUAL_BONUS_MAX_AMOUNT}
                step="0.01"
                value={amount}
                aria-invalid={touched && amountError ? true : undefined}
                onChange={(event) => setAmount(event.target.value)}
              />
            </EField>
            <EField label="Reason (required)">
              <ETextarea id={ids.reason} rows={3} maxLength={MANUAL_BONUS_REASON_MAX} value={reason} aria-invalid={touched && reasonError ? true : undefined} onChange={(event) => setReason(event.target.value)} />
            </EField>
          </fieldset>
          {touched && (amountError || reasonError || needsAcknowledge) ? (
            <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
              {amountError ?? reasonError ?? "Tick “Propose another bonus anyway”, or review the pending bonus."}
            </p>
          ) : null}
          {send.status === "failed" ? (
            <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{`${send.message} Your entry is kept.`}</p>
          ) : null}
        </form>
      )}
    </EActionDialog>
  );
}
