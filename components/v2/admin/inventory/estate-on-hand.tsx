"use client";

/**
 * ESTATE on-hand holdings — v2-native view of who currently holds stock, with
 * native Estate flows to record new holdings and deliver held stock to a unit.
 *   GET  /api/admin/inventory/held-stock                     → { byHolder }
 *   POST /api/admin/inventory/held-stock                     { itemId, holderUserId, quantity, unitCostAud?, sourceNote? }
 *   POST /api/admin/inventory/held-stock/[id]/deliver        { propertyId, quantity }
 * Catalog options (items / holders / properties) are supplied by the hub page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageCheck, Plus, SendToBack } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EStatCard } from "@/components/v2/ui/primitives";
import { EAvatar, EField, EInput, EModal, ESelect, ETableShell } from "@/components/v2/admin/estate-kit";

type Holding = { heldStockId: string; item: { id: string; name: string; unit: string } | null; quantity: number };
type HolderGroup = {
  holder: { id: string; name: string | null; email: string; role: string } | null;
  items: Holding[];
};

export type OnHandCatalog = {
  items: Array<{ id: string; name: string; unit: string }>;
  holders: Array<{ id: string; name: string | null; email: string; role: string }>;
  properties: Array<{ id: string; name: string; suburb: string }>;
};

function roleLabel(role?: string) {
  if (role === "QA_INSPECTOR") return "QA";
  if (role === "OPS_MANAGER") return "Ops";
  if (!role) return "";
  return role.charAt(0) + role.slice(1).toLowerCase();
}

const EMPTY_CATALOG: OnHandCatalog = { items: [], holders: [], properties: [] };

export function EstateOnHand({ catalog = EMPTY_CATALOG }: { catalog?: OnHandCatalog }) {
  const [byHolder, setByHolder] = useState<HolderGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Record-on-hand modal
  const [recordOpen, setRecordOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [holderUserId, setHolderUserId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");
  const [recording, setRecording] = useState(false);

  // Deliver-to-unit modal
  const [deliverFor, setDeliverFor] = useState<Holding | null>(null);
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

  const withStock = useMemo(() => byHolder.filter((g) => g.items.length > 0), [byHolder]);
  const totals = useMemo(
    () => ({
      holders: withStock.length,
      units: byHolder.reduce((s, g) => s + g.items.reduce((n, i) => n + i.quantity, 0), 0),
    }),
    [byHolder, withStock],
  );

  function openRecord() {
    setItemId("");
    setHolderUserId("");
    setQuantity("");
    setUnitCost("");
    setNote("");
    setRecordOpen(true);
  }

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
      if (!res.ok) {
        toast({ title: "Could not record", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: "On-hand stock recorded" });
      setRecordOpen(false);
      await refresh();
    } finally {
      setRecording(false);
    }
  }

  function openDeliver(h: Holding) {
    setDeliverFor(h);
    setDeliverPropertyId("");
    setDeliverQty(String(h.quantity));
  }

  async function deliver() {
    if (!deliverFor) return;
    if (!deliverPropertyId || !(Number(deliverQty) > 0)) {
      toast({ title: "Choose a property and quantity.", variant: "destructive" });
      return;
    }
    setDelivering(true);
    try {
      const res = await fetch(`/api/admin/inventory/held-stock/${deliverFor.heldStockId}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: deliverPropertyId, quantity: Number(deliverQty) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Delivery failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: "Delivered to unit", description: "The unit's stock count was updated." });
      setDeliverFor(null);
      await refresh();
    } finally {
      setDelivering(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <section className="grid grid-cols-2 gap-4 sm:max-w-md">
          <EStatCard label="Holders with stock" value={totals.holders} icon={<PackageCheck className="h-4 w-4" />} />
          <EStatCard label="Units on hand" value={totals.units} icon={<PackageCheck className="h-4 w-4" />} />
        </section>
        <EButton size="sm" variant="gold" onClick={openRecord}>
          <Plus className="h-3.5 w-3.5" /> Record on-hand
        </EButton>
      </div>

      {loading ? (
        <ECard className="p-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</ECard>
      ) : withStock.length === 0 ? (
        <ECard className="p-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          No stock is currently held by anyone.
        </ECard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {withStock.map((group, idx) => (
            <ECard key={group.holder?.id ?? idx} className="overflow-hidden p-0">
              <div className="flex items-center gap-3 border-b border-[hsl(var(--e-border))] px-4 py-3">
                <EAvatar name={group.holder?.name ?? group.holder?.email ?? "?"} size="sm" />
                <div className="min-w-0">
                  <p className="truncate font-[550] text-[hsl(var(--e-foreground))]">
                    {group.holder?.name ?? group.holder?.email ?? "Unknown"}
                  </p>
                  {group.holder?.role ? (
                    <EBadge tone="neutral" soft>
                      {roleLabel(group.holder.role)}
                    </EBadge>
                  ) : null}
                </div>
              </div>
              <ETableShell headers={[{ label: "Item" }, { label: "Qty", align: "right" }, { label: "", align: "right" }]}>
                {group.items.map((h) => (
                  <tr key={h.heldStockId}>
                    <td className="px-4 py-2.5 text-[hsl(var(--e-foreground))]">{h.item?.name ?? "Unknown item"}</td>
                    <td className="px-4 py-2.5 text-right e-numeral text-[hsl(var(--e-foreground))]">
                      {h.quantity}
                      <span className="ml-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                        {h.item?.unit ?? ""}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <EButton size="sm" variant="outline" onClick={() => openDeliver(h)}>
                        <SendToBack className="h-3.5 w-3.5" /> Deliver
                      </EButton>
                    </td>
                  </tr>
                ))}
              </ETableShell>
            </ECard>
          ))}
        </div>
      )}

      <EModal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        eyebrow="On-hand"
        title="Record on-hand stock"
        wide
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Item">
              <ESelect value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">Choose item…</option>
                {catalog.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Held by">
              <ESelect value={holderUserId} onChange={(e) => setHolderUserId(e.target.value)}>
                <option value="">Cleaner / client / QA…</option>
                {catalog.holders.map((h) => (
                  <option key={h.id} value={h.id}>
                    {(h.name || h.email) + " · " + roleLabel(h.role)}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Quantity">
              <EInput type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </EField>
            <EField label="Unit cost ($, optional)">
              <EInput type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </EField>
          </div>
          <EField label="Note (optional)">
            <EInput
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Bought 12 toilet rolls at Costco"
            />
          </EField>
          <EButton className="w-full" variant="gold" onClick={record} disabled={recording}>
            {recording ? "Recording…" : "Record on-hand"}
          </EButton>
        </div>
      </EModal>

      <EModal
        open={Boolean(deliverFor)}
        onClose={() => setDeliverFor(null)}
        eyebrow="Deliver"
        title={`Deliver ${deliverFor?.item?.name ?? "stock"} to a unit`}
      >
        <div className="space-y-4">
          <EField label="To property">
            <ESelect value={deliverPropertyId} onChange={(e) => setDeliverPropertyId(e.target.value)}>
              <option value="">Select property…</option>
              {catalog.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.suburb}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Quantity" hint={deliverFor ? `Up to ${deliverFor.quantity} ${deliverFor.item?.unit ?? ""} on hand` : undefined}>
            <EInput
              type="number"
              min={0}
              max={deliverFor?.quantity}
              step="0.01"
              value={deliverQty}
              onChange={(e) => setDeliverQty(e.target.value)}
            />
          </EField>
          <EButton className="w-full" variant="gold" onClick={deliver} disabled={delivering}>
            {delivering ? "Delivering…" : "Confirm delivery"}
          </EButton>
        </div>
      </EModal>
    </div>
  );
}
