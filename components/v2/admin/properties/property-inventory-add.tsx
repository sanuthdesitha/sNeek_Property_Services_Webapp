"use client";

/**
 * Add-item affordances for the v2 property Inventory tab — Estate-native port
 * of v1's addPresetItem / addCustomItem (app/admin/properties/[id]/page.tsx).
 *
 * Same endpoints as v1:
 *   GET  /api/admin/inventory/items     (full catalog, for duplicate checks)
 *   GET  /api/admin/inventory/defaults  (preset Airbnb items)
 *   POST /api/admin/inventory/items     (create a custom item)
 *
 * Adding an item is a two-step commit, exactly like v1: this component only
 * hands the item to the parent (which stages a pending stock row); the row is
 * persisted when the parent saves via POST /api/admin/inventory/property/:id/
 * set-levels, whose upsert creates missing PropertyStock rows.
 */
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  INVENTORY_LOCATIONS,
  INVENTORY_LOCATION_LABELS,
  normalizeInventoryLocation,
  type InventoryLocation,
} from "@/lib/inventory/locations";
import { EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";

export interface InventoryCatalogItem {
  id: string;
  name: string;
  category: string;
  location: InventoryLocation;
  unit: string;
  supplier?: string | null;
}

export interface AddItemDefaults {
  onHand: number;
  parLevel: number;
  reorderThreshold: number;
}

const EMPTY_CUSTOM = {
  name: "",
  category: "Custom",
  location: "CLEANERS_CUPBOARD" as InventoryLocation,
  unit: "unit",
  supplier: "",
  onHand: "0",
  parLevel: "6",
  reorderThreshold: "2",
};

function normalizeCatalog(rows: unknown): InventoryCatalogItem[] {
  return Array.isArray(rows)
    ? rows
        .filter((row: any) => row?.id && row?.name)
        .map((row: any) => ({
          id: String(row.id),
          name: String(row.name),
          category: String(row.category ?? ""),
          location: normalizeInventoryLocation(row.location),
          unit: String(row.unit ?? "unit"),
          supplier: row.supplier ?? null,
        }))
    : [];
}

export function PropertyInventoryAdd({
  existingItemIds,
  onAddItem,
}: {
  /** Item ids already staged or saved on this property — kept out of the preset list. */
  existingItemIds: Set<string>;
  onAddItem: (item: InventoryCatalogItem, defaults?: AddItemDefaults) => void;
}) {
  const [presets, setPresets] = useState<InventoryCatalogItem[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [customItem, setCustomItem] = useState(EMPTY_CUSTOM);
  const [addingCustom, setAddingCustom] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/inventory/defaults")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!cancelled) setPresets(normalizeCatalog(rows));
      })
      .catch(() => {
        if (!cancelled) setPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const availablePresets = presets.filter((item) => !existingItemIds.has(item.id));

  // Keep a valid preset pre-selected as the available list shrinks/loads.
  useEffect(() => {
    if (!selectedPresetId || !availablePresets.some((item) => item.id === selectedPresetId)) {
      setSelectedPresetId(availablePresets[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, existingItemIds]);

  function addPreset() {
    const item = availablePresets.find((row) => row.id === selectedPresetId);
    if (!item) {
      toast({ title: "Select a preset item first.", variant: "destructive" });
      return;
    }
    onAddItem(item);
    toast({ title: "Preset item added", description: `${item.name} is staged — save levels to keep it.` });
  }

  async function addCustom() {
    if (!customItem.name.trim()) {
      toast({ title: "Custom item name is required.", variant: "destructive" });
      return;
    }
    setAddingCustom(true);
    try {
      const res = await fetch("/api/admin/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customItem.name.trim(),
          category: customItem.category.trim() || "Custom",
          location: customItem.location,
          unit: customItem.unit.trim() || "unit",
          supplier: customItem.supplier.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not create custom item.");
      }
      const created = normalizeCatalog([body])[0];
      if (!created) {
        throw new Error("Unexpected response creating the item.");
      }
      onAddItem(created, {
        onHand: Number(customItem.onHand || 0),
        parLevel: Number(customItem.parLevel || 6),
        reorderThreshold: Number(customItem.reorderThreshold || 2),
      });
      setCustomItem(EMPTY_CUSTOM);
      toast({ title: "Custom item added", description: "Save levels to attach it permanently to this property." });
    } catch (err) {
      toast({
        title: "Create failed",
        description: err instanceof Error ? err.message : "Could not create custom item.",
        variant: "destructive",
      });
    } finally {
      setAddingCustom(false);
    }
  }

  function setC<K extends keyof typeof customItem>(key: K, value: (typeof customItem)[K]) {
    setCustomItem((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ECard>
        <ECardHeader className="pb-2">
          <ECardTitle className="text-[0.875rem]">Add preset item</ECardTitle>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Standard Airbnb inventory items not yet tracked at this property.
          </p>
        </ECardHeader>
        <ECardBody className="pt-0">
          <div className="flex flex-col gap-2 sm:flex-row">
            <ESelect
              value={selectedPresetId}
              onChange={(e) => setSelectedPresetId(e.target.value)}
              className="min-w-0 flex-1"
              aria-label="Preset inventory item"
            >
              <option value="">Select preset item</option>
              {availablePresets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({INVENTORY_LOCATION_LABELS[item.location]} · {item.category})
                </option>
              ))}
            </ESelect>
            <EButton variant="outline" size="sm" onClick={addPreset} disabled={!selectedPresetId}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add preset
            </EButton>
          </div>
          {availablePresets.length === 0 && presets.length > 0 ? (
            <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              Every preset item is already tracked here.
            </p>
          ) : null}
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader className="pb-2">
          <ECardTitle className="text-[0.875rem]">Add custom item</ECardTitle>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Create a new catalog item and stage it here with opening levels.
          </p>
        </ECardHeader>
        <ECardBody className="space-y-3 pt-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Name">
              <EInput value={customItem.name} onChange={(e) => setC("name", e.target.value)} placeholder="e.g. Dish tablets" />
            </EField>
            <EField label="Category">
              <EInput value={customItem.category} onChange={(e) => setC("category", e.target.value)} />
            </EField>
            <EField label="Location">
              <ESelect
                value={customItem.location}
                onChange={(e) => setC("location", normalizeInventoryLocation(e.target.value))}
              >
                {INVENTORY_LOCATIONS.map((location) => (
                  <option key={location} value={location}>
                    {INVENTORY_LOCATION_LABELS[location]}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Unit">
              <EInput value={customItem.unit} onChange={(e) => setC("unit", e.target.value)} />
            </EField>
            <EField label="Supplier" className="sm:col-span-2">
              <EInput value={customItem.supplier} onChange={(e) => setC("supplier", e.target.value)} placeholder="Optional" />
            </EField>
            <EField label="On hand">
              <EInput type="number" min="0" value={customItem.onHand} onChange={(e) => setC("onHand", e.target.value)} />
            </EField>
            <EField label="Par level">
              <EInput type="number" min="0" value={customItem.parLevel} onChange={(e) => setC("parLevel", e.target.value)} />
            </EField>
            <EField label="Reorder at">
              <EInput
                type="number"
                min="0"
                value={customItem.reorderThreshold}
                onChange={(e) => setC("reorderThreshold", e.target.value)}
              />
            </EField>
          </div>
          <div className="flex justify-end">
            <EButton variant="outline" size="sm" onClick={addCustom} disabled={addingCustom}>
              <Plus className="mr-1 h-3.5 w-3.5" /> {addingCustom ? "Adding…" : "Add custom item"}
            </EButton>
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
