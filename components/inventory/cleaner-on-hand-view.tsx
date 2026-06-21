"use client";

import { useCallback, useEffect, useState } from "react";
import { PackageCheck, SendToBack, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

type Property = { id: string; name: string; suburb: string };
type Holding = { id: string; quantity: number; item: { id: string; name: string; unit: string } | null };

export function CleanerOnHandView({ properties }: { properties: Property[] }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [qty, setQty] = useState("");
  const [delivering, setDelivering] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cleaner/inventory/held-stock", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setHoldings(Array.isArray(body.holdings) ? body.holdings : []);
    } finally {
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
      const res = await fetch(`/api/cleaner/inventory/held-stock/${id}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, quantity: Number(qty) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: "Delivery failed", description: body.error, variant: "destructive" }); return; }
      toast({ title: "Delivered", description: "The unit's stock count was updated." });
      setOpenFor(null); setPropertyId(""); setQty("");
      await refresh();
    } finally {
      setDelivering(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading your on-hand stock…</p>;
  if (holdings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        <PackageCheck className="mx-auto mb-2 h-6 w-6" />
        You have no stock on hand. Items you shop for get added here so you can drop them at the unit.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {holdings.map((h) => (
        <Card key={h.id}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{h.item?.name ?? "Item"}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{h.quantity} {h.item?.unit ?? "unit"}(s) on hand</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setOpenFor(h.id); setPropertyId(""); setQty(String(h.quantity)); }}
              >
                <SendToBack className="mr-1.5 h-3.5 w-3.5" /> Deliver
              </Button>
            </div>
            {openFor === h.id ? (
              <div className="mt-2 grid gap-2 rounded-lg bg-muted/40 p-2 sm:grid-cols-[1fr_90px_auto]">
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="To property" /></SelectTrigger>
                  <SelectContent>
                    {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.suburb}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" min={0} max={h.quantity} step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} className="h-9 tabular-nums" />
                <Button size="sm" className="h-9" onClick={() => deliver(h.id)} disabled={delivering}>
                  {delivering ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
