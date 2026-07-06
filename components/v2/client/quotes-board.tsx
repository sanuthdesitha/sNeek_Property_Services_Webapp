"use client";

/**
 * Estate quotes board — same endpoints as the legacy ClientQuotesPage:
 *   GET   /api/client/quotes                    → { quotes: Quote[] }
 *   PATCH /api/client/quotes                    { quoteId, action: "ACCEPT"|"DECLINE" }
 */
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Check, Loader2, X } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EEyebrow,
  EThread,
} from "@/components/v2/ui/primitives";
import { EInlineNotice } from "@/components/v2/client/fields";

type LineItem = { label: string; unitPrice: number; qty: number; total: number };
type Quote = {
  id: string;
  serviceType: string;
  lineItems: LineItem[] | unknown;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  notes: string | null;
  validUntil: string | null;
  status: string;
  createdAt: string;
};

const STATUS: Record<string, { label: string; tone: "gold" | "success" | "danger" | "neutral" }> = {
  SENT: { label: "Awaiting your response", tone: "gold" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  DECLINED: { label: "Declined", tone: "danger" },
  CONVERTED: { label: "Booked", tone: "neutral" },
};

function serviceLabel(s: string) {
  return s
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function money(value: number) {
  return `$${Number(value).toFixed(2)}`;
}

export function ClientQuotesBoard() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/client/quotes", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not load quotes.");
      setQuotes(Array.isArray(body.quotes) ? body.quotes : []);
    } catch (err: any) {
      setLoadError(err?.message ?? "Could not load quotes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(quoteId: string, action: "ACCEPT" | "DECLINE") {
    setActing(quoteId + action);
    setErrorById((prev) => ({ ...prev, [quoteId]: "" }));
    try {
      const res = await fetch("/api/client/quotes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update the quote.");
      await load();
    } catch (err: any) {
      setErrorById((prev) => ({ ...prev, [quoteId]: err?.message ?? "Could not update the quote." }));
    } finally {
      setActing(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your quotes…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-3">
        <EInlineNotice tone="danger">{loadError}</EInlineNotice>
        <EButton variant="outline" size="sm" onClick={load}>
          Retry
        </EButton>
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <EEmptyState
        eyebrow="Nothing yet"
        title="No quotes on file"
        description="Estimates prepared for you will appear here, ready to review and accept."
      />
    );
  }

  return (
    <div className="space-y-5">
      {quotes.map((q) => {
        const items: LineItem[] = Array.isArray(q.lineItems) ? (q.lineItems as LineItem[]) : [];
        const st = STATUS[q.status] ?? { label: q.status, tone: "neutral" as const };
        const open = q.status === "SENT";
        return (
          <ECard key={q.id} variant={open ? "ceremony" : "default"}>
            <ECardBody className="space-y-4 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <EEyebrow>Quotation</EEyebrow>
                  <p className="e-display-sm mt-1">{serviceLabel(q.serviceType)}</p>
                  <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Issued {format(new Date(q.createdAt), "d MMM yyyy")}
                    {q.validUntil ? ` · valid until ${format(new Date(q.validUntil), "d MMM yyyy")}` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <EBadge tone={st.tone} soft>
                    {st.label}
                  </EBadge>
                  <p className="e-numeral text-[1.5rem] leading-none">{money(q.totalAmount)}</p>
                </div>
              </div>

              {items.length > 0 ? (
                <>
                  <EThread />
                  <div className="overflow-x-auto">
                    <table className="w-full text-[0.8125rem]">
                      <tbody>
                        {items.map((li, i) => (
                          <tr key={i} className="border-b border-[hsl(var(--e-border))] last:border-b-0">
                            <td className="py-2 pr-3">{li.label}</td>
                            <td className="py-2 pr-3 text-right text-[hsl(var(--e-muted-foreground))] e-tnum">
                              {li.qty % 1 === 0 ? li.qty : li.qty.toFixed(2)}
                            </td>
                            <td className="e-numeral py-2 text-right">{money(li.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              <div className="flex flex-col items-end gap-0.5 text-[0.8125rem]">
                <span className="text-[hsl(var(--e-muted-foreground))]">
                  Subtotal <span className="e-numeral">{money(q.subtotal)}</span>
                </span>
                {Number(q.gstAmount) > 0 ? (
                  <span className="text-[hsl(var(--e-muted-foreground))]">
                    GST <span className="e-numeral">{money(q.gstAmount)}</span>
                  </span>
                ) : null}
                <span className="mt-0.5 text-[0.9375rem] font-medium">
                  Total <span className="e-numeral text-[1.125rem]">{money(q.totalAmount)}</span>
                </span>
              </div>

              {q.notes ? (
                <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  {q.notes}
                </p>
              ) : null}

              {errorById[q.id] ? <EInlineNotice tone="danger">{errorById[q.id]}</EInlineNotice> : null}

              {open ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <EButton
                    variant="outline"
                    size="sm"
                    disabled={acting === q.id + "DECLINE"}
                    onClick={() => respond(q.id, "DECLINE")}
                  >
                    <X className="h-3.5 w-3.5" /> Decline
                  </EButton>
                  <EButton
                    variant="gold"
                    size="sm"
                    disabled={acting === q.id + "ACCEPT"}
                    onClick={() => respond(q.id, "ACCEPT")}
                  >
                    {acting === q.id + "ACCEPT" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Accept quote
                  </EButton>
                </div>
              ) : null}
            </ECardBody>
          </ECard>
        );
      })}
    </div>
  );
}
