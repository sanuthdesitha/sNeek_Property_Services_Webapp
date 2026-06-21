"use client";

import { useEffect, useState } from "react";
import { Receipt, CreditCard, ImageIcon, FileText, ShoppingBag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type PurchaseLine = { itemName: string; qty: number; unit: string; property: string; lineCost: number | null };
type PurchaseReceipt = { url: string | null; name: string; mimeType: string | null; amount: number | null };
type Purchase = {
  id: string;
  title: string;
  date: string;
  shopper: string;
  paymentMethod: string | null;
  total: number;
  lines: PurchaseLine[];
  receipts: PurchaseReceipt[];
};

function money(n: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n || 0);
}

export function ClientPurchasesFeed() {
  const [runs, setRuns] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/client/inventory/purchases", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (active && res.ok) setRuns(Array.isArray(body.runs) ? body.runs : []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading purchases…</p>;
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        <ShoppingBag className="mx-auto mb-2 h-6 w-6" />
        No purchases have been logged for your properties yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {runs.map((run) => (
        <Card key={run.id}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingBag className="h-4 w-4" /> {run.title}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {run.paymentMethod ? (
                  <Badge variant="secondary" className="gap-1">
                    <CreditCard className="h-3 w-3" /> {run.paymentMethod}
                  </Badge>
                ) : null}
                <Badge variant="outline" className="tabular-nums">{money(run.total)}</Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {new Date(run.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })} · Shopped by {run.shopper}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="divide-y divide-border rounded-lg border border-border">
              {run.lines.map((line, i) => (
                <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate">
                    {line.itemName}
                    <span className="text-muted-foreground"> · {line.property}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {line.qty} {line.unit}
                    {line.lineCost != null ? ` · ${money(line.lineCost)}` : ""}
                  </span>
                </div>
              ))}
            </div>

            {run.receipts.length > 0 ? (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Receipt className="h-3.5 w-3.5" /> Receipts
                </p>
                <div className="flex flex-wrap gap-2">
                  {run.receipts.map((r, i) => {
                    const isImage = (r.mimeType ?? "").startsWith("image/");
                    return r.url ? (
                      <a
                        key={i}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative block h-20 w-20 overflow-hidden rounded-lg border border-border bg-surface-raised"
                        title={r.name}
                      >
                        {isImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.url} alt={r.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                        ) : (
                          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                            <FileText className="h-5 w-5" />
                            <span className="text-[9px]">PDF</span>
                          </span>
                        )}
                        {r.amount != null ? (
                          <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[9px] font-medium text-white tabular-nums">
                            {money(r.amount)}
                          </span>
                        ) : null}
                      </a>
                    ) : (
                      <span key={i} className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                        <ImageIcon className="h-5 w-5" />
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
