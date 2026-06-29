"use client";

import { useEffect, useState } from "react";
import { PackagePlus, Loader2, Check, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

type Property = { id: string; name: string; suburb: string | null };
type Item = {
  propertyStockId: string;
  name: string;
  category: string | null;
  unit: string | null;
  onHand: number;
  parLevel: number;
  reorderThreshold: number;
};

export function CleanerRestockClient() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [adds, setAdds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/cleaner/inventory/restock", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      setLoading(false);
      if (!res.ok) {
        toast({ title: "Could not load properties", description: body.error, variant: "destructive" });
        return;
      }
      setProperties(body.properties ?? []);
    })();
  }, []);

  async function loadItems(id: string) {
    setLoadingItems(true);
    setItems([]);
    setAdds({});
    const res = await fetch(`/api/cleaner/inventory/restock?propertyId=${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoadingItems(false);
    if (!res.ok) {
      toast({ title: "Could not load inventory", description: body.error, variant: "destructive" });
      return;
    }
    setItems(body.items ?? []);
  }

  function setAdd(id: string, value: string) {
    setAdds((prev) => ({ ...prev, [id]: value }));
  }

  const lines = items
    .map((it) => ({ propertyStockId: it.propertyStockId, addQty: Number(adds[it.propertyStockId]) }))
    .filter((l) => Number.isFinite(l.addQty) && l.addQty > 0);

  async function save() {
    if (lines.length === 0) {
      toast({ title: "Enter how much you restocked for at least one item.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/cleaner/inventory/restock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, lines }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Restock failed", description: body.error, variant: "destructive" });
      return;
    }
    toast({ title: "Inventory updated", description: `${body.count} item(s) restocked.` });
    await loadItems(propertyId);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<PackagePlus />}
        title="Restock inventory"
        description="Topped up supplies at a property? Record what you added so on-hand counts stay accurate — any time, in or out of a job."
      />

      <Card>
        <CardContent className="p-4">
          <Label className="text-xs text-muted-foreground">Property</Label>
          {loading ? (
            <p className="py-3 text-sm text-muted-foreground">Loading your properties…</p>
          ) : properties.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No inventory-enabled properties are assigned to you yet.</p>
          ) : (
            <Select
              value={propertyId}
              onValueChange={(v) => {
                setPropertyId(v);
                void loadItems(v);
              }}
            >
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Choose a property…" /></SelectTrigger>
              <SelectContent>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{p.suburb ? ` · ${p.suburb}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {propertyId ? (
        loadingItems ? (
          <Card><CardContent className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading inventory…</CardContent></Card>
        ) : items.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No inventory items for this property.</CardContent></Card>
        ) : (
          <>
            <div className="space-y-2">
              {items.map((it) => {
                const low = it.onHand <= it.reorderThreshold;
                return (
                  <Card key={it.propertyStockId}>
                    <CardContent className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{it.name}</p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          On hand: <span className="tabular-nums font-medium text-foreground">{it.onHand}</span>
                          {it.unit ? ` ${it.unit}` : ""}
                          {low ? (
                            <Badge variant="warning" className="ml-1 gap-1 px-1.5 py-0 text-[10px]">
                              <AlertTriangle className="h-2.5 w-2.5" /> Low
                            </Badge>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">+ Added</span>
                        <Input
                          type="number"
                          min={0}
                          step="1"
                          inputMode="numeric"
                          value={adds[it.propertyStockId] ?? ""}
                          onChange={(e) => setAdd(it.propertyStockId, e.target.value)}
                          className="h-10 w-20 text-center"
                          placeholder="0"
                        />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="sticky bottom-0 z-10 -mx-1 rounded-xl border border-border bg-surface/95 px-3 py-3 backdrop-blur">
              <Button className="h-12 w-full" onClick={() => void save()} disabled={saving || lines.length === 0}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                {lines.length > 0 ? `Save restock (${lines.length} item${lines.length === 1 ? "" : "s"})` : "Enter quantities to restock"}
              </Button>
            </div>
          </>
        )
      ) : null}
    </div>
  );
}
