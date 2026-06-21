"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageCheck, Plus, SendToBack, Loader2, User2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

type Item = { id: string; name: string; unit: string };
type Holder = { id: string; name: string | null; email: string; role: string };
type Property = { id: string; name: string; suburb: string };

type Holding = {
  id: string;
  quantity: number;
  item: { id: string; name: string; unit: string } | null;
  holder: { id: string; name: string | null; email: string; role: string } | null;
};
type HolderGroup = {
  holder: Holding["holder"];
  items: Array<{ heldStockId: string; item: Holding["item"]; quantity: number }>;
};

function roleLabel(role?: string) {
  if (role === "QA_INSPECTOR") return "QA";
  if (role === "OPS_MANAGER") return "Ops";
  if (!role) return "";
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function OnHandWorkspace({
  items,
  holders,
  properties,
}: {
  items: Item[];
  holders: Holder[];
  properties: Property[];
}) {
  const [byHolder, setByHolder] = useState<HolderGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Record-on-hand form
  const [itemId, setItemId] = useState("");
  const [holderUserId, setHolderUserId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");
  const [recording, setRecording] = useState(false);

  // Deliver dialog state (per holding)
  const [deliverFor, setDeliverFor] = useState<string | null>(null);
  const [deliverPropertyId, setDeliverPropertyId] = useState("");
  const [deliverQty, setDeliverQty] = useState("");
  const [delivering, setDelivering] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/inventory/held-stock", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setByHolder(Array.isArray(body.byHolder) ? body.byHolder : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totalUnits = useMemo(
    () => byHolder.reduce((sum, g) => sum + g.items.reduce((s, i) => s + i.quantity, 0), 0),
    [byHolder]
  );

  async function record() {
    if (!itemId || !holderUserId || !(Number(quantity) > 0)) {
      toast({ title: "Item, holder and quantity are required.", variant: "destructive" });
      return;
    }
    setRecording(true);
    try {
      const res = await fetch("/api/admin/inventory/held-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          holderUserId,
          quantity: Number(quantity),
          unitCostAud: unitCost ? Number(unitCost) : null,
          sourceNote: note.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: "Could not record", description: body.error, variant: "destructive" }); return; }
      toast({ title: "On-hand stock recorded" });
      setQuantity(""); setUnitCost(""); setNote("");
      await refresh();
    } finally {
      setRecording(false);
    }
  }

  async function deliver(heldStockId: string) {
    if (!deliverPropertyId || !(Number(deliverQty) > 0)) {
      toast({ title: "Choose a property and quantity.", variant: "destructive" });
      return;
    }
    setDelivering(true);
    try {
      const res = await fetch(`/api/admin/inventory/held-stock/${heldStockId}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: deliverPropertyId, quantity: Number(deliverQty) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: "Delivery failed", description: body.error, variant: "destructive" }); return; }
      toast({ title: "Delivered to unit", description: "The unit's stock count was updated." });
      setDeliverFor(null); setDeliverPropertyId(""); setDeliverQty("");
      await refresh();
    } finally {
      setDelivering(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Record on-hand */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" /> Record on-hand stock
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs">Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger><SelectValue placeholder="Choose item" /></SelectTrigger>
              <SelectContent>
                {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Held by</Label>
            <Select value={holderUserId} onValueChange={setHolderUserId}>
              <SelectTrigger><SelectValue placeholder="Cleaner / client / QA" /></SelectTrigger>
              <SelectContent>
                {holders.map((h) => (
                  <SelectItem key={h.id} value={h.id}>{(h.name || h.email)} · {roleLabel(h.role)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Quantity</Label>
            <Input type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Unit cost ($, optional)</Label>
            <Input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="tabular-nums" />
          </div>
          <div className="flex items-end">
            <Button className="h-10 w-full" onClick={record} disabled={recording}>
              {recording ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />} Add
            </Button>
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-5">
            <Label className="text-xs">Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bought 12 toilet rolls at Costco" />
          </div>
        </CardContent>
      </Card>

      {/* On-hand board */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Currently on hand</p>
        <Badge variant="secondary" className="tabular-nums">{totalUnits} unit(s) across {byHolder.length} holder(s)</Badge>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : byHolder.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <PackageCheck className="mx-auto mb-2 h-6 w-6" />
          No stock is on hand right now. Record a purchase above.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {byHolder.map((group) => (
            <Card key={group.holder?.id ?? Math.random().toString()}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary"><User2 className="h-4 w-4" /></span>
                  {group.holder?.name || group.holder?.email || "Unknown"}
                  <Badge variant="outline" className="ml-1 text-[10px]">{roleLabel(group.holder?.role)}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {group.items.map((it) => (
                  <div key={it.heldStockId} className="rounded-lg border border-border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{it.item?.name ?? "Item"}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">{it.quantity} {it.item?.unit ?? "unit"}(s) on hand</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDeliverFor(it.heldStockId);
                          setDeliverPropertyId("");
                          setDeliverQty(String(it.quantity));
                        }}
                      >
                        <SendToBack className="mr-1.5 h-3.5 w-3.5" /> Deliver
                      </Button>
                    </div>
                    {deliverFor === it.heldStockId ? (
                      <div className="mt-2 grid gap-2 rounded-lg bg-muted/40 p-2 sm:grid-cols-[1fr_90px_auto]">
                        <Select value={deliverPropertyId} onValueChange={setDeliverPropertyId}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="To property" /></SelectTrigger>
                          <SelectContent>
                            {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.suburb}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min={0}
                          max={it.quantity}
                          step="0.01"
                          value={deliverQty}
                          onChange={(e) => setDeliverQty(e.target.value)}
                          className="h-9 tabular-nums"
                        />
                        <Button size="sm" className="h-9" onClick={() => deliver(it.heldStockId)} disabled={delivering}>
                          {delivering ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
