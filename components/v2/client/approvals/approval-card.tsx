"use client";

/**
 * One extra waiting for the client's decision (board 3, "Add-on" card):
 * note, Decline, Offer other price (reveals the counter amount), Approve.
 * All decisions go through `useClientApprovals`; this file only presents.
 */
import { useState } from "react";
import { Check, Loader2, Send, X } from "lucide-react";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import { EInlineNotice, EInput, ELabel, ETextarea } from "@/components/v2/client/fields";
import type { ApprovalRow, ClientApprovalsState } from "@/components/v2/client/approvals/use-client-approvals";
import { approvalMoney, sentenceCase, sydneyDateTime } from "@/components/v2/client/approvals/approval-format";

const TAP = "min-h-11 justify-center";

function contextLine(row: ApprovalRow): string {
  const parts = [
    row.property?.name ?? row.job?.property.name ?? null,
    row.job ? `${sentenceCase(row.job.jobType)} · ${sydneyDateTime(row.job.scheduledDate, "EEE d MMM")} clean` : null,
    `requested ${sydneyDateTime(row.requestedAt)}`,
    row.expiresAt ? `expires ${sydneyDateTime(row.expiresAt)}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function ApprovalCard({ row, approvals }: { row: ApprovalRow; approvals: ClientApprovalsState }) {
  const [offerOpen, setOfferOpen] = useState(Boolean(approvals.counters[row.id]));
  const disabled = approvals.actionsDisabled;
  const amount = approvalMoney(row.amount, row.currency);
  const counterValue = approvals.counters[row.id] ?? "";

  return (
    <ECard className="space-y-2 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <EBadge tone="warning" soft>Add-on</EBadge>
        <span className="e-numeral text-[0.9375rem] font-semibold">{amount}</span>
      </div>
      <p className="text-[0.9375rem] font-semibold">{row.title}</p>
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{contextLine(row)}</p>
      <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{row.description || "No extra description provided."}</p>

      {row.status === "COUNTERED" ? (
        <EInlineNotice tone="info">
          You proposed {approvalMoney(row.counterAmount ?? 0, row.currency)}
          {row.counterNote ? ` — "${row.counterNote}"` : ""}. We will come back to you.
        </EInlineNotice>
      ) : (
        <div className="space-y-2">
          <ELabel htmlFor={`approval-note-${row.id}`} className="sr-only">Optional note</ELabel>
          <ETextarea
            id={`approval-note-${row.id}`}
            value={approvals.notes[row.id] ?? ""}
            onChange={(event) => approvals.setNote(row.id, event.target.value)}
            rows={2}
            placeholder="Optional note"
          />

          {offerOpen ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[10rem] flex-1 space-y-1">
                <ELabel htmlFor={`approval-counter-${row.id}`}>Or propose a different amount ({row.currency})</ELabel>
                <EInput
                  id={`approval-counter-${row.id}`}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={counterValue}
                  onChange={(event) => approvals.setCounter(row.id, event.target.value)}
                  placeholder={String(row.amount)}
                  className="min-h-11"
                />
              </div>
              <EButton variant="outline" className={TAP} disabled={disabled || !counterValue.trim()} onClick={() => void approvals.counter(row.id)}>
                <Send className="h-3.5 w-3.5" /> Send counter-offer
              </EButton>
            </div>
          ) : null}

          {approvals.errors[row.id] ? <EInlineNotice tone="danger">{approvals.errors[row.id]}</EInlineNotice> : null}

          <div className="grid grid-cols-2 gap-2">
            <EButton variant="outline" className={TAP} disabled={disabled} onClick={() => void approvals.respond(row.id, "DECLINE")}>
              <X className="h-3.5 w-3.5" /> Decline
            </EButton>
            <EButton
              variant="outline"
              className={TAP}
              disabled={disabled}
              aria-expanded={offerOpen}
              onClick={() => setOfferOpen((open) => !open)}
            >
              Offer other price
            </EButton>
          </div>
          <EButton variant="gold" size="lg" className="w-full justify-center" disabled={disabled} onClick={() => void approvals.respond(row.id, "APPROVE")}>
            {approvals.savingId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve {amount}
          </EButton>
        </div>
      )}
    </ECard>
  );
}
