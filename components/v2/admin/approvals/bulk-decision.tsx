"use client";

/**
 * Bulk approve / decline for one queue: the bar under the table, the confirm
 * dialog (one optional note on a decline) and the per-row results. One request
 * to POST /api/admin/approvals/bulk; refused rows stay selected with reasons.
 */
import * as React from "react";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { APPROVAL_QUEUES, type ApprovalsQueueKey, type BulkDecision } from "@/lib/admin/approvals/queues";
import { money, type ApprovalQueueRow } from "@/lib/admin/approvals/rows";

export type BulkOutcome = { id: string; status: "done" | "refused" | "unchanged"; message: string };

type BulkDecisionBarProps = {
  queue: ApprovalsQueueKey;
  selectedRows: ApprovalQueueRow[];
  onClear: () => void;
  /** Called after a run with the ids that were not done (they stay selected). */
  onFinished: (remaining: string[]) => Promise<void>;
  /** Opens the dialog for one row (the row menu's Decline). */
  request: { decision: BulkDecision; ids: string[] } | null;
  onRequestHandled: () => void;
  /** Phones: show the selected pay requests' asked total in the docked bar ("2 selected · $60.60"). */
  showPhoneTotal?: boolean;
};

const PAY_QUEUE_KEYS: ApprovalsQueueKey[] = ["payAdjustments", "rectificationAdjustments", "bonusProposals"];
const PAY_QUEUES = new Set<ApprovalsQueueKey>(PAY_QUEUE_KEYS);
/** Queues whose decline route accepts a note (see decision-requests.ts). */
const NOTE_QUEUES = new Set<ApprovalsQueueKey>([...PAY_QUEUE_KEYS, "timeAdjustments", "clientRequests", "rescheduleRequests"]);

const CONSEQUENCE: Partial<Record<ApprovalsQueueKey, string>> = {
  skipRequests: "Approving cancels each of these cleans.",
  falseConfirmations: "Confirming keeps the extra −10 score penalty on each clean; rejecting reverses it.",
  qaOutcomes: "Marks each job completed so it can be invoiced. QA scores and rework jobs are unaffected.",
  rectificationAdjustments: "Approving adds or deducts each amount on the next pay run.",
  bonusProposals: "Approving adds each bonus to the next pay run.",
  qaReworkTransfers: "Approving moves each proposed time and pay to the QA inspector.",
  rescheduleRequests: "Approving moves each job to its requested date.",
};

export function BulkDecisionBar({ queue, selectedRows, onClear, onFinished, request, onRequestHandled, showPhoneTotal = false }: BulkDecisionBarProps) {
  const definition = APPROVAL_QUEUES[queue];
  const [pending, setPending] = React.useState<{ decision: BulkDecision; ids: string[] } | null>(null);
  const [note, setNote] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<BulkOutcome[] | null>(null);
  const ids = React.useId();

  React.useEffect(() => {
    if (!request) return;
    setPending(request);
    setResults(null);
    setError(null);
    onRequestHandled();
  }, [request, onRequestHandled]);

  // Pay requests approved as asked: each selected row's own asked amount, frozen
  // when the dialog opened, shown as a count and total and sent with the ids.
  const payAsAsked = queue === "payAdjustments" && pending?.decision === "approve";
  const askedRows = payAsAsked ? selectedRows.filter((row) => pending?.ids.includes(row.id)) : [];
  const withAmount = askedRows.filter((row) => row.askedAmount != null && Number.isFinite(row.askedAmount) && row.askedAmount > 0);
  const askedTotal = withAmount.reduce((sum, row) => sum + (row.askedAmount ?? 0), 0);
  const expectedAmounts = payAsAsked ? Object.fromEntries(withAmount.map((row) => [row.id, row.askedAmount as number])) : undefined;

  const labelFor = (id: string) => {
    const row = selectedRows.find((item) => item.id === id);
    return row ? `${row.who}${row.jobLabel ? ` · ${row.jobLabel}` : ""}` : id;
  };

  async function run() {
    if (!pending) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/approvals/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queue, decision: pending.decision, ids: pending.ids, note: note.trim() || undefined, noteVisibleToPayee: PAY_QUEUES.has(queue) ? visible : undefined, expectedAmounts }),
      });
      const body = (await res.json().catch(() => null)) as { outcomes?: BulkOutcome[]; error?: string } | null;
      if (!res.ok || !body?.outcomes) {
        setError(body?.error ?? "The decisions could not be sent. Nothing was changed.");
        return;
      }
      setResults(body.outcomes);
      setNote("");
      await onFinished(body.outcomes.filter((row) => row.status !== "done").map((row) => row.id));
    } catch {
      setError("The decisions could not be sent. Check the connection and try again.");
    } finally {
      setRunning(false);
    }
  }

  const close = () => {
    if (running) return;
    setPending(null);
    setResults(null);
    setError(null);
  };

  const rule = pending ? definition.bulk[pending.decision] : null;
  const actionLabel = rule && rule.allowed ? rule.label : "";
  const selectedIds = selectedRows.map((row) => row.id);
  // The same asked amounts the confirm dialog totals; shown only on a phone.
  const selectedAsked = selectedRows.filter((row) => row.askedAmount != null && Number.isFinite(row.askedAmount) && row.askedAmount > 0);
  const phoneTotal = showPhoneTotal && queue === "payAdjustments" && selectedAsked.length > 0
    ? `${money(selectedAsked.reduce((sum, row) => sum + (row.askedAmount ?? 0), 0)) ?? ""} asked`
    : undefined;

  return (
    <>
      {selectedRows.length === 0 ? (
        definition.reviewOnly ? null : (
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Select requests to decide several at once.</p>
        )
      ) : (
        <EBulkBar count={selectedRows.length} noun={{ one: definition.noun, many: `${definition.noun}s` }} onClear={onClear} busy={running} summary={phoneTotal}>
          {(["approve", "decline"] as const).map((decision) => {
            const option = definition.bulk[decision];
            return option.allowed ? (
              <EBulkButton key={decision} onClick={() => { setResults(null); setError(null); setPending({ decision, ids: selectedIds }); }}>
                {option.label}
              </EBulkButton>
            ) : (
              <EBulkButton key={decision} disabled title={option.reason} aria-describedby={`${ids}-${decision}`}>
                {decision === "approve" ? "Approve" : "Decline"}
                <span id={`${ids}-${decision}`} className="sr-only">{option.reason}</span>
              </EBulkButton>
            );
          })}
        </EBulkBar>
      )}
      {selectedRows.length > 0 ? (
        <ul className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {(["approve", "decline"] as const).map((decision) => {
            const option = definition.bulk[decision];
            return option.allowed ? null : <li key={decision}>{decision === "approve" ? "Approve" : "Decline"}: {option.reason}</li>;
          })}
        </ul>
      ) : null}
      <EActionDialog
        open={pending !== null}
        eyebrow={definition.label}
        title={results ? "Results" : `${actionLabel} ${pending?.ids.length ?? 0} ${pending?.ids.length === 1 ? definition.noun : `${definition.noun}s`}?`}
        busy={running}
        onClose={close}
        footer={
          results ? (
            <EButton size="sm" variant="outline" onClick={close}>Close</EButton>
          ) : (
            <>
              <EButton size="sm" variant="ghost" disabled={running} onClick={close}>Cancel</EButton>
              <EButton size="sm" variant={pending?.decision === "decline" ? "danger" : "primary"} disabled={running} onClick={() => void run()}>
                {running ? "Working…" : actionLabel}
              </EButton>
            </>
          )
        }
      >
        {results ? (
          <ul className="space-y-1.5" aria-live="polite">
            {results.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <EPill tone={row.status === "done" ? "ok" : row.status === "unchanged" ? "neutral" : "bad"}>
                  {row.status === "done" ? "Done" : row.status === "unchanged" ? "No change" : "Refused"}
                </EPill>
                <span className="min-w-0 [overflow-wrap:anywhere]">{labelFor(row.id)}</span>
                {row.status !== "done" ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.message}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <fieldset disabled={running} className="space-y-2">
            <p>Each request is decided through its own decision, with the same checks and notices as deciding it on its own.</p>
            {CONSEQUENCE[queue] ? <p className="font-[550]">{CONSEQUENCE[queue]}</p> : null}
            {payAsAsked ? (
              <div className="space-y-1.5">
                <p className="font-[550]">
                  Approve {askedRows.length} pay {askedRows.length === 1 ? "request" : "requests"}, each at its own asked amount: {money(askedTotal) ?? "$0.00"} in total{withAmount.length < askedRows.length ? ` for ${withAmount.length} with an amount` : ""}.
                </p>
                <ul className="max-h-48 space-y-1 overflow-y-auto text-[0.8125rem]">
                  {askedRows.map((row) => (
                    <li key={row.id} className="flex flex-wrap justify-between gap-2">
                      <span className="min-w-0 [overflow-wrap:anywhere]">{labelFor(row.id)}</span>
                      <span className="e-numeral">{money(row.askedAmount) ?? "No amount"}{row.hasEvidence ? "" : " · no receipt"}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">A request without a receipt or amount, waiting for the client, or changed since you selected it is refused with the reason and stays selected. To change an amount, use Review.</p>
              </div>
            ) : null}
            {pending?.decision === "decline" && NOTE_QUEUES.has(queue) ? (
              <>
                <label htmlFor={`${ids}-note`} className="block text-[0.75rem] font-[550]">One note for all, optional</label>
                <textarea id={`${ids}-note`} rows={2} maxLength={2000} className="w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 py-2 text-[16px] sm:text-[0.8125rem]" value={note} onChange={(e) => setNote(e.target.value)} />
                {PAY_QUEUES.has(queue) ? (
                  <label className="flex min-h-[44px] items-center gap-2 text-[0.8125rem]">
                    <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible to the payee
                  </label>
                ) : null}
              </>
            ) : null}
            {error ? <p role="alert" className="text-[hsl(var(--e-danger))]">{error}</p> : null}
          </fieldset>
        )}
      </EActionDialog>
    </>
  );
}
