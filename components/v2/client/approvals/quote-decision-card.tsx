/**
 * A quote waiting for the client's decision, listed on Approvals (board 3,
 * "Quote" card). The buttons are LINKS into the existing quote decision flow on
 * My quotes, which opens with that quote and that action ready; nothing is
 * decided from here. Server-renderable.
 */
import Link from "next/link";
import { EBadge, ECard } from "@/components/v2/ui/primitives";
import { approvalMoney, sentenceCase, sydneyDateTime } from "@/components/v2/client/approvals/approval-format";

export interface QuoteWaiting {
  id: string;
  /** The reference the client can quote back to us ("Q-204"); null when unavailable. */
  reference?: string | null;
  serviceType: string;
  totalAmount: number;
  /** ISO instant; null when the quote has no expiry. */
  validUntil: string | null;
  createdAt: string;
  expired: boolean;
}

export type QuoteIntent = "accept" | "decline" | "change";

export function quoteDecisionHref(id: string, intent: QuoteIntent): string {
  return `/v2/client/quotes?quote=${encodeURIComponent(id)}&intent=${intent}#quote-${encodeURIComponent(id)}`;
}

const LINK = "inline-flex min-h-11 flex-1 items-center justify-center rounded-[var(--e-radius)] px-3 text-[0.8125rem] font-[550] focus-visible:outline focus-visible:outline-2";
const OUTLINE = `${LINK} border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] hover:bg-[hsl(var(--e-muted))]`;
const PRIMARY = `${LINK} bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))]`;

export function QuoteDecisionCard({ quote, compact = false }: { quote: QuoteWaiting; compact?: boolean }) {
  const validity = quote.validUntil
    ? quote.expired
      ? `Expired ${sydneyDateTime(quote.validUntil, "d MMM")} · ask us for an updated quote`
      : `Valid until ${sydneyDateTime(quote.validUntil, "d MMM")}`
    : "No expiry date";
  const title = `${sentenceCase(quote.serviceType)} quote`;
  const label = quote.reference ? `Quote ${quote.reference}` : "Quote";
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.875rem] font-semibold">{title}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {label} · {approvalMoney(quote.totalAmount, "AUD")} · {validity}
          </p>
        </div>
        <Link href={quoteDecisionHref(quote.id, "accept")} className={`${OUTLINE} flex-none`}>Review</Link>
      </div>
    );
  }
  return (
    <ECard className="space-y-1.5 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <EBadge tone="info" soft>{label}</EBadge>
        <span className="e-numeral text-[0.9375rem] font-semibold">{approvalMoney(quote.totalAmount, "AUD")}</span>
      </div>
      <p className="text-[0.9375rem] font-semibold">{title}</p>
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        Issued {sydneyDateTime(quote.createdAt, "d MMM yyyy")} · {validity}
      </p>
      <div className="flex gap-2 pt-1.5">
        <Link href={quoteDecisionHref(quote.id, "decline")} className={OUTLINE}>Decline</Link>
        <Link href={quoteDecisionHref(quote.id, "change")} className={OUTLINE}>Ask for change</Link>
        {quote.expired ? null : <Link href={quoteDecisionHref(quote.id, "accept")} className={PRIMARY}>Accept</Link>}
      </div>
    </ECard>
  );
}
