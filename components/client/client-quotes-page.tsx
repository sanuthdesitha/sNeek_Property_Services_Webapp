"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2, Check, X, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

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

const STATUS: Record<string, { label: string; variant: "secondary" | "success" | "destructive" | "outline" }> = {
  SENT: { label: "Awaiting your response", variant: "secondary" },
  ACCEPTED: { label: "Accepted", variant: "success" },
  DECLINED: { label: "Declined", variant: "destructive" },
  CONVERTED: { label: "Booked", variant: "outline" },
};

function serviceLabel(s: string) {
  return s.toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

export function ClientQuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/client/quotes", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setQuotes(Array.isArray(body.quotes) ? body.quotes : []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function respond(quoteId: string, action: "ACCEPT" | "DECLINE") {
    setActing(quoteId + action);
    try {
      const res = await fetch("/api/client/quotes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update.");
      toast({ title: action === "ACCEPT" ? "Quote accepted" : "Quote declined", description: "Thanks — we've let the team know." });
      await load();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setActing(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your quotes…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Your quotes</h1>
        <p className="text-sm text-muted-foreground">Quotes prepared for you. Review and accept to book.</p>
      </div>

      {quotes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <FileText className="h-8 w-8 opacity-50" />
            <p className="text-sm">You don&apos;t have any quotes yet.</p>
          </CardContent>
        </Card>
      ) : (
        quotes.map((q) => {
          const items: LineItem[] = Array.isArray(q.lineItems) ? (q.lineItems as LineItem[]) : [];
          const st = STATUS[q.status] ?? { label: q.status, variant: "secondary" as const };
          return (
            <Card key={q.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{serviceLabel(q.serviceType)}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Issued {format(new Date(q.createdAt), "dd MMM yyyy")}
                    {q.validUntil ? ` · valid until ${format(new Date(q.validUntil), "dd MMM yyyy")}` : ""}
                  </p>
                </div>
                <Badge variant={st.variant}>{st.label}</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {items.map((li, i) => (
                        <tr key={i} className="border-b last:border-b-0">
                          <td className="py-2 pr-3">{li.label}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{li.qty % 1 === 0 ? li.qty : li.qty.toFixed(2)}</td>
                          <td className="py-2 text-right tabular-nums">${Number(li.total).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col items-end gap-0.5 text-sm">
                  <span className="text-muted-foreground">Subtotal: ${Number(q.subtotal).toFixed(2)}</span>
                  {Number(q.gstAmount) > 0 ? <span className="text-muted-foreground">GST: ${Number(q.gstAmount).toFixed(2)}</span> : null}
                  <span className="text-lg font-semibold">Total: ${Number(q.totalAmount).toFixed(2)}</span>
                </div>
                {q.notes ? <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">{q.notes}</p> : null}
                {q.status === "SENT" ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" disabled={acting === q.id + "DECLINE"} onClick={() => respond(q.id, "DECLINE")}>
                      <X className="mr-2 h-4 w-4" /> Decline
                    </Button>
                    <Button disabled={acting === q.id + "ACCEPT"} onClick={() => respond(q.id, "ACCEPT")}>
                      <Check className="mr-2 h-4 w-4" /> Accept quote
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
