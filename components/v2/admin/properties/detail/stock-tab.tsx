"use client";

/**
 * Stock tab (was "Inventory"): add preset or custom items and edit on hand,
 * par and reorder levels. Moved unchanged in rule: adding only stages a row;
 * "Save levels" upserts every row through
 * POST /api/admin/inventory/property/:id/set-levels. Staged rows and typed
 * levels survive a failed save and a reload of the property.
 */
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, ECardBody, ECardHeader, ECardTitle, EEmptyState } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";
import { PropertyInventoryAdd, type AddItemDefaults, type InventoryCatalogItem } from "../property-inventory-add";
import type { PropertyRecord, StockRecord } from "./property-record";

type LevelDraft = { onHand: string; parLevel: string; reorderThreshold: string };
type StockRow = StockRecord & { pending?: boolean };

function draftOf(row: StockRecord): LevelDraft {
  return { onHand: String(row.onHand ?? 0), parLevel: String(row.parLevel ?? 0), reorderThreshold: String(row.reorderThreshold ?? 0) };
}

export function StockTab({ property, onSaved }: { property: PropertyRecord; onSaved: () => void }) {
  const saved = property.propertyStock;
  const [drafts, setDrafts] = useState<Record<string, LevelDraft>>({});
  const [staged, setStaged] = useState<Array<{ itemId: string; item: InventoryCatalogItem }>>([]);
  const [saving, setSaving] = useState(false);

  // Fill drafts for rows that have none yet; typed values are kept.
  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of saved) if (!next[row.itemId]) next[row.itemId] = draftOf(row);
      return next;
    });
  }, [saved]);

  const savedIds = new Set(saved.map((row) => row.itemId));
  const rows: StockRow[] = [
    ...saved,
    ...staged
      .filter((row) => !savedIds.has(row.itemId))
      .map((row) => ({ itemId: row.itemId, onHand: 0, parLevel: 6, reorderThreshold: 2, item: row.item, pending: true })),
  ];

  function stage(item: InventoryCatalogItem, defaults?: AddItemDefaults) {
    if (rows.some((row) => row.itemId === item.id)) {
      toast({ title: "Item already added", description: `${item.name} is already tracked at this property.` });
      return;
    }
    setStaged((current) => [...current, { itemId: item.id, item }]);
    setDrafts((current) => ({
      ...current,
      [item.id]: { onHand: String(defaults?.onHand ?? 0), parLevel: String(defaults?.parLevel ?? 6), reorderThreshold: String(defaults?.reorderThreshold ?? 2) },
    }));
  }

  async function saveLevels() {
    setSaving(true);
    const levels = rows.map((row) => {
      const draft = drafts[row.itemId] ?? draftOf(row);
      return { itemId: row.itemId, onHand: Number(draft.onHand || 0), parLevel: Number(draft.parLevel || 0), reorderThreshold: Number(draft.reorderThreshold || 0) };
    });
    try {
      const response = await fetch(`/api/admin/inventory/property/${property.id}/set-levels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast({ title: "Save failed", description: body.error ?? "Could not save stock levels.", variant: "destructive" });
        return;
      }
      toast({ title: "Stock levels updated" });
      setStaged([]);
      setDrafts({});
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PropertyInventoryAdd existingItemIds={new Set(rows.map((row) => row.itemId))} onAddItem={stage} />
      <ECard>
        <ECardHeader className="flex-row items-center justify-between pb-2">
          <ECardTitle className="text-[0.95rem]">Property stock levels</ECardTitle>
          {rows.length > 0 ? (
            <EButton variant="gold" size="sm" onClick={saveLevels} disabled={saving}>
              <Save className="mr-1 h-3.5 w-3.5" /> {saving ? "Saving…" : "Save levels"}
            </EButton>
          ) : null}
        </ECardHeader>
        <ECardBody className="pt-0">
          {rows.length === 0 ? (
            <EEmptyState eyebrow="No stock" title="Inventory not tracked" description="Add a preset or custom item above to start tracking stock for this property." />
          ) : (
            <div role="region" aria-label="Property stock levels" tabIndex={0} className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <fieldset disabled={saving} className="contents">
                <table className="w-full min-w-[32rem] text-[0.8125rem]">
                  <thead>
                    <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                      {["Item", "On hand", "Par level", "Reorder at"].map((head) => (
                        <th key={head} scope="col" className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{head}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const draft = drafts[row.itemId] ?? draftOf(row);
                      const setDraft = (patch: Partial<LevelDraft>) => setDrafts((current) => ({ ...current, [row.itemId]: { ...draft, ...patch } }));
                      const name = row.item?.name ?? "Item";
                      return (
                        <tr key={row.itemId} className="border-t border-[hsl(var(--e-border)/0.7)]">
                          <td className="px-3 py-2">
                            <p className="font-[550]">{name}{row.pending ? <EBadge tone="gold" soft className="ml-1.5">Unsaved</EBadge> : null}</p>
                            <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{[row.item?.category, row.item?.unit].filter(Boolean).join(" · ")}</p>
                          </td>
                          <td className="px-3 py-2"><EInput aria-label={`${name} on hand`} type="number" min="0" className="h-9 w-24" value={draft.onHand} onChange={(e) => setDraft({ onHand: e.target.value })} /></td>
                          <td className="px-3 py-2"><EInput aria-label={`${name} par level`} type="number" min="0" className="h-9 w-24" value={draft.parLevel} onChange={(e) => setDraft({ parLevel: e.target.value })} /></td>
                          <td className="px-3 py-2"><EInput aria-label={`${name} reorder at`} type="number" min="0" className="h-9 w-24" value={draft.reorderThreshold} onChange={(e) => setDraft({ reorderThreshold: e.target.value })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </fieldset>
            </div>
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
