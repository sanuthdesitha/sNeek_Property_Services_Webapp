"use client";

/**
 * "Waiting for your decision" in the desktop dashboard's right column. Extras
 * can be declined or approved here through the same approvals hook (and the
 * same version check) as the Approvals screen; anything needing a note or a
 * counter-offer, and every quote, opens the full flow.
 */
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EInlineNotice } from "@/components/v2/client/fields";
import { useClientApprovals } from "@/components/v2/client/approvals/use-client-approvals";
import { QuoteDecisionCard, type QuoteWaiting } from "@/components/v2/client/approvals/quote-decision-card";
import { approvalMoney, sydneyDateTime } from "@/components/v2/client/approvals/approval-format";

export function DesktopDecisions({ quotes }: { quotes: QuoteWaiting[] | null }) {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || session?.user?.role !== "CLIENT") return null;
  const identity = JSON.stringify([session.user.id, session.impersonation?.actorId, session.impersonation?.mode, session.impersonation?.startedAt]);
  return <Decisions key={identity} quotes={quotes} />;
}

function Decisions({ quotes }: { quotes: QuoteWaiting[] | null }) {
  const approvals = useClientApprovals();
  const pending = approvals.rows.filter((row) => row.status === "PENDING" || row.status === "COUNTERED");
  if (approvals.loading && !approvals.hasSnapshot) {
    return <p role="status" className="flex items-center gap-2 text-[0.8125rem]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading decisions…</p>;
  }
  return (
    <div className="space-y-2">
      {approvals.stale ? <EInlineNotice tone="danger">Approval terms have changed. Open Approvals to review them.</EInlineNotice> : null}
      {approvals.loadError ? (
        <div className="flex items-center justify-between gap-2">
          <EInlineNotice tone="danger">{approvals.loadError}</EInlineNotice>
          <EButton variant="outline" size="sm" className="min-h-11" disabled={approvals.loading} onClick={() => void approvals.reload()}>Retry</EButton>
        </div>
      ) : null}
      {pending.map((row) => (
        <div key={row.id} className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[0.875rem] font-semibold">{row.title}{row.property ? `, ${row.property.name}` : ""}</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Add-on{row.job ? ` · ${sydneyDateTime(row.job.scheduledDate, "EEE d MMM")}` : ""} · {approvalMoney(row.amount, row.currency)}
            </p>
            {approvals.errors[row.id] ? <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{approvals.errors[row.id]}</p> : null}
          </div>
          {row.status === "COUNTERED" ? (
            <span className="shrink-0 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">You proposed {approvalMoney(row.counterAmount ?? 0, row.currency)}</span>
          ) : (
            <div className="flex shrink-0 gap-1.5">
              <EButton variant="outline" size="sm" className="min-h-11" disabled={approvals.actionsDisabled} onClick={() => void approvals.respond(row.id, "DECLINE")}>Decline</EButton>
              <EButton variant="gold" size="sm" className="min-h-11" disabled={approvals.actionsDisabled} onClick={() => void approvals.respond(row.id, "APPROVE")}>
                {approvals.savingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Approve
              </EButton>
            </div>
          )}
        </div>
      ))}
      {quotes === null ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Quotes unavailable.</p> : null}
      {(quotes ?? []).map((quote) => <QuoteDecisionCard key={quote.id} quote={quote} compact />)}
      {approvals.hasSnapshot && !approvals.loadError && pending.length === 0 && (quotes ?? []).length === 0 && quotes !== null ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Nothing waiting for your decision.</p>
      ) : null}
      <p className="text-[0.75rem]"><Link href="/v2/client/approvals" className="underline">Add a note or offer another price</Link></p>
    </div>
  );
}
