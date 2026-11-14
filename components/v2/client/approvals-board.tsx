"use client";

/**
 * Client Approvals (board 3): "Waiting N | History". Extras the office priced
 * are approved, declined or countered here; quotes waiting for a decision are
 * listed alongside and open the existing quote flow. Decisions and safeguards
 * live in `useClientApprovals` (same endpoints as before).
 */
import { tourTarget } from "@/lib/tutorials/targets";
import { useSession } from "next-auth/react";
import { Info, Loader2, RotateCw } from "lucide-react";
import { EBadge, EButton, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { EInlineNotice } from "@/components/v2/client/fields";
import { SegmentLinks } from "@/components/v2/client/portal/segment-links";
import { useClientApprovals, type ApprovalRow, type ClientApprovalsState } from "@/components/v2/client/approvals/use-client-approvals";
import { ApprovalCard } from "@/components/v2/client/approvals/approval-card";
import { QuoteDecisionCard, type QuoteWaiting } from "@/components/v2/client/approvals/quote-decision-card";
import { approvalMoney, approvalStatusTone, sydneyDateTime } from "@/components/v2/client/approvals/approval-format";

export type ApprovalsView = "waiting" | "history";

export interface ClientApprovalsBoardProps {
  view?: ApprovalsView;
  /** Quotes waiting for a decision, read on the server; null when they could not be read. */
  quotes?: QuoteWaiting[] | null;
}

export function ClientApprovalsBoard(props: ClientApprovalsBoardProps) {
  const { data: session, status } = useSession();
  if (status === "loading") return <p role="status">Loading approval requests...</p>;
  if (status !== "authenticated" || !session?.user?.id || session.user.role !== "CLIENT") {
    return <EInlineNotice tone="danger">Approvals unavailable for this account.</EInlineNotice>;
  }
  const identity = JSON.stringify([session.user.id, session.user.role, session.impersonation?.actorId,
    session.impersonation?.mode, session.impersonation?.startedAt]);
  return <SessionApprovalsBoard key={identity} {...props} />;
}

function StatusBanners({ approvals }: { approvals: ClientApprovalsState }) {
  const { stale, loadError, loading, hasSnapshot, savingId, reload } = approvals;
  return (
    <>
      {stale ? (
        <div className="flex flex-wrap items-center gap-3">
          <EInlineNotice tone="danger">Approval terms have changed. Refresh and review the updated terms before submitting another decision. Your notes have been preserved.</EInlineNotice>
          <EButton variant="outline" className="min-h-11" disabled={loading || savingId !== null} onClick={() => void reload()}>
            <RotateCw className="h-3.5 w-3.5" /> Refresh
          </EButton>
        </div>
      ) : null}
      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <EInlineNotice tone="danger">{loadError}{hasSnapshot ? " Showing previously loaded approvals; this view may be incomplete or out of date." : ""}</EInlineNotice>
          <EButton variant="outline" className="min-h-11" disabled={loading || savingId !== null} onClick={() => void reload()}>
            <RotateCw className="h-3.5 w-3.5" /> {loading ? "Retrying..." : "Retry"}
          </EButton>
        </div>
      ) : null}
      {loading && hasSnapshot && !loadError ? <p role="status">Refreshing approvals; showing previously loaded requests...</p> : null}
    </>
  );
}

function HistoryList({ rows }: { rows: ApprovalRow[] }) {
  if (rows.length === 0) {
    return <EEmptyState eyebrow="No history yet" title="No decisions recorded" description="Approved, declined and expired requests appear here." />;
  }
  return (
    <ECard className="overflow-hidden">
      <ul className="divide-y divide-[hsl(var(--e-border))]">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[0.875rem] font-medium">{row.title}</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {sydneyDateTime(row.requestedAt, "d MMM yyyy")}{row.property ? ` · ${row.property.name}` : ""}
              </p>
              {row.responseNote ? (
                <p className="mt-1 whitespace-pre-wrap text-[0.75rem] italic text-[hsl(var(--e-text-secondary))]">“{row.responseNote}”</p>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <p className="e-numeral text-[0.9375rem]">{approvalMoney(row.amount, row.currency)}</p>
              <EBadge tone={approvalStatusTone(row.status)} soft>{row.status.charAt(0) + row.status.slice(1).toLowerCase()}</EBadge>
            </div>
          </li>
        ))}
      </ul>
    </ECard>
  );
}

function SessionApprovalsBoard({ view = "waiting", quotes = [] }: ClientApprovalsBoardProps) {
  const approvals = useClientApprovals();
  const { rows, hasSnapshot, loading, loadError } = approvals;
  // A COUNTERED row is still live: the ball is with the office, so it stays
  // out of history rather than looking settled.
  const pending = rows.filter((row) => row.status === "PENDING" || row.status === "COUNTERED");
  const history = rows.filter((row) => row.status !== "PENDING" && row.status !== "COUNTERED");
  const quoteList = quotes ?? [];
  const verified = hasSnapshot && !loading && !loadError && quotes !== null;
  const waitingCount = verified ? pending.length + quoteList.length : undefined;

  if (loading && !hasSnapshot && !loadError) {
    return (
      <div className="flex items-center gap-2 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading approval requests…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SegmentLinks
        label="Approval views"
        activeKey={view}
        links={[
          { key: "waiting", label: "Waiting", href: "/v2/client/approvals", count: waitingCount },
          { key: "history", label: "History", href: "/v2/client/approvals?view=history" },
        ]}
      />
      <StatusBanners approvals={approvals} />

      {hasSnapshot && view === "waiting" ? (
        <section aria-label="Waiting for your decision" className="space-y-3">
          {!verified ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Waiting count unverified.</p> : null}
          {pending.map((row, index) => (
            <div key={row.id} {...(index === 0 ? tourTarget("client.approvals.card") : {})}>
              <ApprovalCard row={row} approvals={approvals} />
            </div>
          ))}
          {quotes === null ? <EInlineNotice tone="danger">Quotes waiting for a decision could not be loaded. Open My quotes to check.</EInlineNotice> : null}
          {quoteList.map((quote, index) => (
            <div key={quote.id} {...(index === 0 ? tourTarget("client.approvals.quote") : {})}>
              <QuoteDecisionCard quote={quote} />
            </div>
          ))}
          {verified && pending.length === 0 && quoteList.length === 0 ? (
            <EEmptyState eyebrow="All clear" title="Nothing awaiting approval" description="Optional extras and quotes appear here before anything is billed to your account." />
          ) : null}
        </section>
      ) : null}
      {hasSnapshot && view === "history" ? <HistoryList rows={history} /> : null}

      <p className="flex gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Nothing optional is billed until you approve it here.</span>
      </p>
    </div>
  );
}
