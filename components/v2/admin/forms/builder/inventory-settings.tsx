"use client";

/**
 * ESTATE form builder — template-level "Inventory" settings card (R8a).
 *
 * Edits `schema.inventoryConfig`: whether the cleaner's hardcoded
 * "Stock & consumables used" block offers ALL of the property's stocked items
 * (the default) or only an admin-selected subset of the inventory catalog.
 * The catalog comes from the existing admin inventory API
 * (GET /api/admin/inventory/items — the builder is admin-only).
 *
 * Which items actually appear on a job remains the intersection of this
 * selection with what the property stocks (the form route filters its
 * `inventoryStock` payload through filterStockByConfig).
 */
import * as React from "react";
import { Loader2, Package } from "lucide-react";
import type { InventoryConfig } from "@/lib/forms/inventory-config";

interface CatalogItem {
  id: string;
  name: string;
  category?: string | null;
  unit?: string | null;
  isActive?: boolean;
}

export function InventorySettingsCard({
  config,
  onChange,
}: {
  config: InventoryConfig | undefined;
  onChange: (next: InventoryConfig | undefined) => void;
}) {
  const mode: "all" | "selected" = config?.mode === "selected" ? "selected" : "all";
  const selectedIds = React.useMemo(() => new Set(config?.itemIds ?? []), [config]);

  const [items, setItems] = React.useState<CatalogItem[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // Load the catalog lazily, only once "Only selected items" is in play.
  React.useEffect(() => {
    if (mode !== "selected" || items !== null) return;
    let cancelled = false;
    fetch("/api/admin/inventory/items")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`(${res.status})`))))
      .then((body) => {
        if (cancelled) return;
        setItems(Array.isArray(body) ? (body as CatalogItem[]).filter((it) => it.isActive !== false) : []);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message ?? "Could not load the inventory catalog.");
      });
    return () => {
      cancelled = true;
    };
  }, [mode, items]);

  function setMode(nextMode: "all" | "selected") {
    if (nextMode === "all") {
      // "All items" is the schema default — drop the key entirely.
      onChange(undefined);
    } else {
      onChange({ mode: "selected", itemIds: config?.itemIds ?? [] });
    }
  }

  function toggleItem(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ mode: "selected", itemIds: Array.from(next) });
  }

  // Group by category for a scannable list.
  const groups = React.useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const it of items ?? []) {
      const key = (it.category || "General").toString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
      <p className="flex items-center gap-1.5 text-[0.8125rem] font-[600]">
        <Package className="size-4" /> Inventory
      </p>
      <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Which stocked items the cleaner can record usage against in this form&apos;s
        &ldquo;Stock &amp; consumables used&rdquo; block. Only items the property actually stocks appear
        on a job.
      </p>

      <div className="mt-3 space-y-2">
        <label className="flex items-start gap-2 text-[0.8125rem]">
          <input
            type="radio"
            name="inventory-config-mode"
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--e-gold))]"
            checked={mode === "all"}
            onChange={() => setMode("all")}
          />
          <span>
            <span className="font-[550]">All stocked items</span>
            <span className="block text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              Every active item the property stocks (default).
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[0.8125rem]">
          <input
            type="radio"
            name="inventory-config-mode"
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--e-gold))]"
            checked={mode === "selected"}
            onChange={() => setMode("selected")}
          />
          <span>
            <span className="font-[550]">Only selected items</span>
            <span className="block text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              Pick which catalog items this template offers. None selected = the block shows no
              items.
            </span>
          </span>
        </label>
      </div>

      {mode === "selected" ? (
        <div className="mt-3 max-h-64 space-y-3 overflow-y-auto rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-3">
          {loadError ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">
              Could not load the inventory catalog {loadError}
            </p>
          ) : items === null ? (
            <p className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              <Loader2 className="size-3.5 animate-spin" /> Loading catalog…
            </p>
          ) : items.length === 0 ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              No active inventory items in the catalog yet.
            </p>
          ) : (
            groups.map(([category, rows]) => (
              <div key={category} className="space-y-1">
                <p className="text-[0.6875rem] font-[550] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                  {category}
                </p>
                {rows.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 text-[0.8125rem]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[hsl(var(--e-gold))]"
                      checked={selectedIds.has(it.id)}
                      onChange={() => toggleItem(it.id)}
                    />
                    <span className="min-w-0 truncate">
                      {it.name}
                      {it.unit ? (
                        <span className="ml-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          ({it.unit})
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            ))
          )}
          <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
            {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"} selected.
          </p>
        </div>
      ) : null}
    </div>
  );
}
