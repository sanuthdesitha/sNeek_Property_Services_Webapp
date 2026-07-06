"use client";

/**
 * Estate cleaner restock panel — record supplies topped up at a property so
 * on-hand counts stay accurate. Same endpoint + payload as the live cleaner
 * restock workspace (components/cleaner/restock-client.tsx):
 *   GET  /api/cleaner/inventory/restock                → { properties }
 *   GET  /api/cleaner/inventory/restock?propertyId=…   → { items }
 *   POST /api/cleaner/inventory/restock  { propertyId, lines: [{ propertyStockId, addQty }] }
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, PackagePlus } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/cleaner/fields";
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

export function RestockPanel() {
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
    const res = await fetch(
      `/api/cleaner/inventory/restock?propertyId=${encodeURIComponent(id)}`,
      { cache: "no-store" }
    );
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
    <div className="space-y-5">
      {/* Property picker */}
      <ECard>
        <ECardBody className="space-y-3 pt-6">
          <EEyebrow>PROPERTY</EEyebrow>
          {loading ? (
            <p className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your properties…
            </p>
          ) : properties.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No inventory-enabled properties are assigned to you yet.
            </p>
          ) : (
            <EField label="Choose a property to restock">
              <ESelect
                value={propertyId}
                onChange={(e) => {
                  const v = e.target.value;
                  setPropertyId(v);
                  if (v) void loadItems(v);
                }}
              >
                <option value="">Choose a property…</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.suburb ? ` · ${p.suburb}` : ""}
                  </option>
                ))}
              </ESelect>
            </EField>
          )}
        </ECardBody>
      </ECard>

      {/* Item list */}
      {propertyId ? (
        loadingItems ? (
          <ECard>
            <ECardBody className="flex items-center justify-center gap-2 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading inventory…
            </ECardBody>
          </ECard>
        ) : items.length === 0 ? (
          <ECard>
            <ECardBody className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No inventory items for this property.
            </ECardBody>
          </ECard>
        ) : (
          <>
            <div className="space-y-2">
              {items.map((it) => {
                const low = it.onHand <= it.reorderThreshold;
                return (
                  <ECard key={it.propertyStockId}>
                    <ECardBody className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-[0.875rem] font-[550]">{it.name}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          On hand:{" "}
                          <span className="e-tnum font-medium text-[hsl(var(--e-foreground))]">
                            {it.onHand}
                          </span>
                          {it.unit ? ` ${it.unit}` : ""}
                          {low ? (
                            <EBadge tone="warning" soft className="ml-1">
                              <AlertTriangle className="h-2.5 w-2.5" /> Low
                            </EBadge>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          + Added
                        </span>
                        <EInput
                          type="number"
                          min={0}
                          step="1"
                          inputMode="numeric"
                          value={adds[it.propertyStockId] ?? ""}
                          onChange={(e) => setAdd(it.propertyStockId, e.target.value)}
                          className="w-20 text-center"
                          placeholder="0"
                          aria-label={`Quantity added for ${it.name}`}
                        />
                      </div>
                    </ECardBody>
                  </ECard>
                );
              })}
            </div>

            <div className="sticky bottom-0 z-10 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.95)] px-3 py-3 backdrop-blur">
              <EButton
                variant="gold"
                className="h-12 w-full"
                onClick={() => void save()}
                disabled={saving || lines.length === 0}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : lines.length > 0 ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <PackagePlus className="h-4 w-4" />
                )}
                {lines.length > 0
                  ? `Save restock (${lines.length} item${lines.length === 1 ? "" : "s"})`
                  : "Enter quantities to restock"}
              </EButton>
            </div>
          </>
        )
      ) : null}
    </div>
  );
}
