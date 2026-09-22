"use client";

/**
 * Estate cleaner on-hand stock view. Same endpoints as the live view
 * (components/inventory/cleaner-on-hand-view.tsx):
 *   GET  /api/cleaner/inventory/held-stock                     → { holdings }
 *   POST /api/cleaner/inventory/held-stock/{id}/deliver
 *          { propertyId, quantity }
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, PackageCheck, SendToBack } from "lucide-react";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/cleaner/fields";
import { useSession } from "next-auth/react";
import { StockBatchForm } from "./stock-batch-form";
import { OwnStockEntry, type StockItem } from "./own-stock-entry";
import { toast } from "@/hooks/use-toast";
import { groupHeldStock } from "@/lib/inventory/held-stock-grouping";
import { pendingHeldStockDelivery, sendHeldStockDelivery } from "@/lib/inventory/held-stock-delivery-client";

type Property = { id: string; name: string; suburb: string };
type Holding = { id: string; quantity: number; updatedAt: string; sourceNote?: string | null; item: { id: string; name: string; unit: string; category?: string } | null };

export function OnHandView({ properties }: { properties: Property[] }) {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || !session?.user.id) return null;
  const scope = JSON.stringify([session.user.id, session.impersonation ?? null]);
  return <ScopedOnHand key={scope} scope={scope} properties={properties} readOnly={session.impersonation?.mode === "READ_ONLY"} />;
}
function ScopedOnHand({ properties, scope, readOnly }: { properties: Property[]; scope: string; readOnly: boolean }) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [error, setError] = useState("");
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjustFor, setAdjustFor] = useState<string | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [qty, setQty] = useState("");
  const [delivering, setDelivering] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cleaner/inventory/held-stock", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(body.holdings) || !Array.isArray(body.items)) throw new Error("Your stock could not be loaded. Refresh to try again.");
      setHoldings(body.holdings); setItems(body.items); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "Stock unavailable."); } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function deliver(id: string) {
    if (!propertyId || !(Number(qty) > 0)) {
      toast({ title: "Choose a property and quantity.", variant: "destructive" });
      return;
    }
    setDelivering(true);
    try {
      const receipt = await sendHeldStockDelivery(scope, `/api/cleaner/inventory/held-stock/${id}/deliver`, { propertyId, quantity: Number(qty) });
      toast({ title: "Delivered", description: receipt.notificationWarning || "The unit's stock count was updated." });
      setOpenFor(null);
      setPropertyId("");
      setQty("");
      await refresh();
    } catch (error) {
      toast({ title: "Delivery not confirmed", description: error instanceof Error ? error.message : "Retry the same delivery.", variant: "destructive" });
    } finally {
      setDelivering(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your on-hand stock…
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <EButton variant="outline" className="min-h-11" onClick={() => void refresh()}>Refresh stock</EButton>
      {error ? <div role="alert">{error}<EButton onClick={() => void refresh()}>Refresh stock</EButton></div> : readOnly ? <p>Read-only view.</p> : <><StockBatchForm scope={scope} action="RECORD" items={items} holdings={holdings} properties={properties} onSaved={refresh} /><StockBatchForm scope={scope} action="DELIVER" items={items} holdings={holdings} properties={properties} onSaved={refresh} /><details><summary className="min-h-11 py-2 cursor-pointer text-sm">Recover an earlier single-item entry</summary><OwnStockEntry scope={scope} items={items} onSaved={refresh} /></details></>}
      {!error && !holdings.length ? <p>You have no stock recorded on hand.</p> : null}
      <p className="text-sm">Repeated additions of the same item are grouped below. Open the entries to correct quantities or record a delivery.</p>
      {groupHeldStock(holdings).map(group => (
        <section key={group.key} className="space-y-2">
          <h3 className="text-sm font-semibold break-words">{group.category} · {group.item?.name ?? "Unknown item"}</h3>
          <p className="text-sm">Total: {Number(group.quantity.toFixed(6))} {group.item?.unit ?? "unit"}(s) · {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}</p>
          <details open={group.entries.length === 1}>
            <summary className="cursor-pointer min-h-11 py-2 text-sm">View entries and update stock</summary>
      {group.entries.map((h, index) => (
        <ECard key={h.id} className="mb-2">
          <ECardBody className="py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words text-[0.875rem] font-[550]">{group.entries.length > 1 ? `Entry ${index + 1}` : h.item?.name ?? "Item"}</p>
                {h.sourceNote ? <p className="text-xs break-words">{h.sourceNote}</p> : null}
                <p className="e-tnum text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {h.quantity} {h.item?.unit ?? "unit"}(s) on hand
                </p>
              </div>
              <EButton
                size="sm"
                disabled={readOnly || h.quantity <= 0}
                variant="outline"
                onClick={() => {
                  try {
                    const pending = pendingHeldStockDelivery(scope, `/api/cleaner/inventory/held-stock/${h.id}/deliver`);
                    setOpenFor(h.id); setPropertyId(pending?.propertyId ?? ""); setQty(String(pending?.quantity ?? h.quantity));
                  } catch (error) { toast({ title: "Delivery unavailable", description: error instanceof Error ? error.message : "Enable browser storage.", variant: "destructive" }); }
                }}
              >
                <SendToBack className="h-3.5 w-3.5" /> Deliver
              </EButton>
            </div>
            {!readOnly ? <EButton variant="ghost" className="min-h-11 mt-2" onClick={() => setAdjustFor(adjustFor === h.id ? null : h.id)}>Set remaining quantity</EButton> : null}
            {!readOnly && adjustFor === h.id ? <OwnStockEntry key={h.updatedAt} scope={scope} holding={h} items={[]} onSaved={refresh} /> : null}
            {openFor === h.id ? (
              <div className="mt-2 grid gap-2 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-2 sm:grid-cols-[1fr_90px_auto]">
                <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  <option value="">To property</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.suburb}
                    </option>
                  ))}
                </ESelect>
                <EInput
                  type="number"
                  min={0}
                  max={h.quantity}
                  step="0.01"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="e-tnum"
                />
                <EButton size="sm" onClick={() => void deliver(h.id)} disabled={delivering || readOnly}>
                  {delivering ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
                </EButton>
              </div>
            ) : null}
          </ECardBody>
        </ECard>
      ))}
          </details>
        </section>
      ))}
    </div>
  );
}
