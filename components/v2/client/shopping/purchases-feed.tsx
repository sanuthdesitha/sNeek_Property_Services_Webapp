"use client";

/**
 * Estate purchases feed — same endpoint as the legacy ClientPurchasesFeed:
 *   GET /api/client/inventory/purchases → { runs: Purchase[] }
 * Styled purely with `--e-*` tokens. No v1 UI imports.
 */
import { useEffect, useState } from "react";
import { Receipt, CreditCard, ImageIcon, FileText, ShoppingBag } from "lucide-react";
import { EBadge, ECard, ECardBody, EEmptyState, EEyebrow } from "@/components/v2/ui/primitives";
import { EInlineNotice } from "@/components/v2/client/fields";

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

export function PurchasesFeed() {
  const [runs, setRuns] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/client/inventory/purchases", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!active) return;
        if (res.ok) setRuns(Array.isArray(body.runs) ? body.runs : []);
        else setError(body.error ?? "Could not load purchases.");
      } catch {
        if (active) setError("Could not load purchases.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading purchases…</p>;
  if (error) return <EInlineNotice tone="danger">{error}</EInlineNotice>;
  if (runs.length === 0) {
    return (
      <EEmptyState
        eyebrow="Nothing yet"
        title="No purchases logged"
        description="Everything bought for your units — including by our team — will appear here with receipts and payment details."
      />
    );
  }

  return (
    <div className="space-y-4">
      {runs.map((run) => (
        <ECard key={run.id}>
          <ECardBody className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-[550] text-[hsl(var(--e-foreground))]">
                  <ShoppingBag className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> {run.title}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {new Date(run.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })} ·
                  Shopped by {run.shopper}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {run.paymentMethod ? (
                  <EBadge tone="neutral" soft>
                    <CreditCard className="h-3 w-3" /> {run.paymentMethod}
                  </EBadge>
                ) : null}
                <span className="e-tnum e-numeral text-[1.125rem] text-[hsl(var(--e-gold-ink))]">{money(run.total)}</span>
              </div>
            </div>

            <div className="divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              {run.lines.map((line, i) => (
                <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[0.8125rem]">
                  <span className="min-w-0 truncate">
                    {line.itemName}
                    <span className="text-[hsl(var(--e-muted-foreground))]"> · {line.property}</span>
                  </span>
                  <span className="e-tnum shrink-0 text-[hsl(var(--e-muted-foreground))]">
                    {line.qty} {line.unit}
                    {line.lineCost != null ? ` · ${money(line.lineCost)}` : ""}
                  </span>
                </div>
              ))}
            </div>

            {run.receipts.length > 0 ? (
              <div>
                <EEyebrow className="mb-1.5 flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5" /> Receipts
                </EEyebrow>
                <div className="flex flex-wrap gap-2">
                  {run.receipts.map((r, i) => {
                    const isImage = (r.mimeType ?? "").startsWith("image/");
                    return r.url ? (
                      <a
                        key={i}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative block h-20 w-20 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]"
                        title={r.name}
                      >
                        {isImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.url} alt={r.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                        ) : (
                          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-[hsl(var(--e-muted-foreground))]">
                            <FileText className="h-5 w-5" />
                            <span className="text-[9px]">PDF</span>
                          </span>
                        )}
                        {r.amount != null ? (
                          <span className="e-tnum absolute inset-x-0 bottom-0 bg-[hsl(160_18%_8%/0.65)] px-1 py-0.5 text-center text-[9px] font-medium text-white">
                            {money(r.amount)}
                          </span>
                        ) : null}
                      </a>
                    ) : (
                      <span
                        key={i}
                        className="flex h-20 w-20 items-center justify-center rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))]"
                      >
                        <ImageIcon className="h-5 w-5" />
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </ECardBody>
        </ECard>
      ))}
    </div>
  );
}
