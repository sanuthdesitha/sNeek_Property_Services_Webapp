"use client";

/**
 * ESTATE inventory items — v2-native replacement for the v1
 * InventoryItemsWorkspace (catalog slice). Same endpoints:
 *   GET    /api/admin/inventory/items                → InventoryItem[]
 *   POST   /api/admin/inventory/items                { name, sku?, category, location, unit, supplier?, unitCost? }
 *   PATCH  /api/admin/inventory/items/[id]           { name, category, location, unit, supplier, unitCost, isActive }
 * Archive = PATCH isActive:false (same as the classic desk's archive toggle).
 * CSV import/export is native (Estate EModal):
 *   POST /api/admin/inventory/items/import   { csv }            → { created, updated, errors }
 *   GET  /api/admin/inventory/items/export                      → CSV download (direct link)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Download, Pencil, Plus, RotateCcw, Search, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  INVENTORY_LOCATIONS,
  INVENTORY_LOCATION_LABELS,
  type InventoryLocation,
} from "@/lib/inventory/locations";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  EModal,
  ESelect,
  ETableShell,
  ETextarea,
} from "@/components/v2/admin/estate-kit";

type InventoryItem = {
  id: string;
  name: string;
  sku?: string | null;
  category: string;
  location: InventoryLocation;
  unit: string;
  supplier?: string | null;
  unitCost?: number | null;
  isActive: boolean;
};

type Draft = {
  name: string;
  sku: string;
  category: string;
  location: InventoryLocation;
  unit: string;
  supplier: string;
  unitCost: string;
};

const EMPTY: Draft = {
  name: "",
  sku: "",
  category: "Custom",
  location: "CLEANERS_CUPBOARD",
  unit: "unit",
  supplier: "",
  unitCost: "",
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);

export function EstateItems() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importResult, setImportResult] = useState<{
    created: number;
    updated: number;
    errors: Array<{ line: number; message: string }>;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/inventory/items");
      const body = await res.json().catch(() => []);
      setItems(Array.isArray(body) ? body : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (!showInactive && !it.isActive) return false;
      if (q && !`${it.name} ${it.sku ?? ""} ${it.category} ${it.supplier ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [items, search, showInactive]);

  function openCreate() {
    setDraft(EMPTY);
    setCreating(true);
  }
  function openEdit(it: InventoryItem) {
    setEditing(it);
    setDraft({
      name: it.name,
      sku: it.sku ?? "",
      category: it.category,
      location: it.location,
      unit: it.unit,
      supplier: it.supplier ?? "",
      unitCost: it.unitCost == null ? "" : String(it.unitCost),
    });
  }

  async function saveDraft() {
    if (!draft.name.trim()) {
      toast({ title: "Item name is required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const unitCost = draft.unitCost.trim() === "" ? undefined : Number(draft.unitCost);
      if (editing) {
        const res = await fetch(`/api/admin/inventory/items/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name.trim(),
            category: draft.category.trim() || "Custom",
            location: draft.location,
            unit: draft.unit.trim() || "unit",
            supplier: draft.supplier.trim() || null,
            unitCost: unitCost ?? null,
            isActive: editing.isActive,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({ title: "Save failed", description: body.error, variant: "destructive" });
          return;
        }
        toast({ title: "Item updated" });
        setEditing(null);
      } else {
        const res = await fetch("/api/admin/inventory/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name.trim(),
            sku: draft.sku.trim() || undefined,
            category: draft.category.trim() || "Custom",
            location: draft.location,
            unit: draft.unit.trim() || "unit",
            supplier: draft.supplier.trim() || undefined,
            unitCost,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({ title: "Create failed", description: body.error, variant: "destructive" });
          return;
        }
        toast({ title: "Item added" });
        setCreating(false);
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(it: InventoryItem) {
    setBusyId(it.id);
    try {
      const res = await fetch(`/api/admin/inventory/items/${it.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: it.name,
          category: it.category,
          location: it.location,
          unit: it.unit,
          supplier: it.supplier ?? null,
          unitCost: it.unitCost ?? null,
          isActive: !it.isActive,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: it.isActive ? "Item archived" : "Item restored" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function openImport() {
    setCsvText("");
    setImportResult(null);
    setImportOpen(true);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setCsvText(await file.text());
      setImportResult(null);
    } catch {
      toast({ title: "Could not read file", variant: "destructive" });
    }
  }

  async function runImport() {
    const csv = csvText.trim();
    if (!csv) {
      toast({ title: "Paste or upload a CSV first.", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/admin/inventory/items/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Import failed", description: body.error, variant: "destructive" });
        return;
      }
      setImportResult({
        created: body.created ?? 0,
        updated: body.updated ?? 0,
        errors: Array.isArray(body.errors) ? body.errors : [],
      });
      toast({ title: `Imported — ${body.created ?? 0} new, ${body.updated ?? 0} updated` });
      await load();
    } finally {
      setImporting(false);
    }
  }

  const modalOpen = creating || Boolean(editing);
  function closeModal() {
    setCreating(false);
    setEditing(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
            <EInput
              className="h-9 w-64 pl-9"
              placeholder="Search name, SKU, category or supplier…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show archived
          </label>
        </div>
        <div className="flex items-center gap-2">
          <EButton size="sm" variant="outline" onClick={openImport}>
            <Upload className="h-3.5 w-3.5" /> Import
          </EButton>
          <EButton size="sm" variant="outline" asChild>
            <a href="/api/admin/inventory/items/export" download>
              <Download className="h-3.5 w-3.5" /> Export
            </a>
          </EButton>
          <EButton size="sm" variant="gold" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> Add item
          </EButton>
        </div>
      </div>

      <ECard className="overflow-hidden p-0">
        {loading ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No items match.
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Item" },
              { label: "Category" },
              { label: "Location" },
              { label: "Supplier" },
              { label: "Unit cost", align: "right" },
              { label: "", align: "right" },
            ]}
          >
            {filtered.map((it) => (
              <tr key={it.id} className={it.isActive ? "" : "opacity-60"}>
                <td className="px-4 py-3">
                  <span className="font-[550] text-[hsl(var(--e-foreground))]">{it.name}</span>
                  <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                    {it.sku ? `SKU ${it.sku} · ` : ""}
                    per {it.unit}
                    {it.isActive ? "" : " · archived"}
                  </p>
                </td>
                <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  {it.category}
                </td>
                <td className="px-4 py-3">
                  <EBadge tone="neutral" soft>
                    {INVENTORY_LOCATION_LABELS[it.location] ?? it.location}
                  </EBadge>
                </td>
                <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  {it.supplier || "—"}
                </td>
                <td className="px-4 py-3 text-right e-numeral text-[hsl(var(--e-foreground))]">
                  {money(it.unitCost)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <EButton size="sm" variant="outline" onClick={() => openEdit(it)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </EButton>
                    <EButton
                      size="sm"
                      variant="ghost"
                      disabled={busyId === it.id}
                      onClick={() => toggleArchive(it)}
                      className={it.isActive ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-success))]"}
                    >
                      {it.isActive ? (
                        <>
                          <Archive className="h-3.5 w-3.5" /> Archive
                        </>
                      ) : (
                        <>
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </>
                      )}
                    </EButton>
                  </div>
                </td>
              </tr>
            ))}
          </ETableShell>
        )}
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Per-property stock levels are set from the property matrix &amp; count sheets. Use Import/Export
        above for bulk catalog changes.
      </p>

      <EModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        eyebrow="Catalog"
        title="Import items from CSV"
        wide
      >
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            Header row required. Columns: <span className="e-numeral">name</span> (required), sku,
            category, location, unit, supplier, isActive. Existing items (matched by SKU, or
            name+category+location) are updated; new ones are created.
          </p>
          <div className="flex items-center gap-2">
            <EButton size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Choose CSV file
            </EButton>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onPickFile}
            />
            <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">or paste below</span>
          </div>
          <EField label="CSV contents">
            <ETextarea
              rows={8}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={"name,sku,category,location,unit,supplier,isActive\nToilet roll,,Bathroom,STORE_ROOM,pack,Costco,true"}
              className="font-mono text-[0.75rem]"
            />
          </EField>
          {importResult ? (
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.8125rem]">
              <p className="text-[hsl(var(--e-foreground))]">
                <span className="text-[hsl(var(--e-success))]">{importResult.created} created</span> ·{" "}
                {importResult.updated} updated
                {importResult.errors.length > 0 ? (
                  <span className="text-[hsl(var(--e-danger))]"> · {importResult.errors.length} error(s)</span>
                ) : null}
              </p>
              {importResult.errors.length > 0 ? (
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[0.75rem] text-[hsl(var(--e-danger))]">
                  {importResult.errors.slice(0, 20).map((err, i) => (
                    <li key={i}>
                      Line {err.line}: {err.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <EButton className="w-full" variant="gold" onClick={runImport} disabled={importing}>
            {importing ? "Importing…" : "Import CSV"}
          </EButton>
        </div>
      </EModal>

      <EModal
        open={modalOpen}
        onClose={closeModal}
        eyebrow="Catalog"
        title={editing ? `Edit — ${editing.name}` : "Add inventory item"}
        wide
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Name">
              <EInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </EField>
            <EField label="SKU (optional)">
              <EInput
                value={draft.sku}
                disabled={Boolean(editing)}
                onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
              />
            </EField>
            <EField label="Category">
              <EInput
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
            </EField>
            <EField label="Location">
              <ESelect
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value as InventoryLocation })}
              >
                {INVENTORY_LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {INVENTORY_LOCATION_LABELS[loc]}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Unit">
              <EInput value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
            </EField>
            <EField label="Supplier (optional)">
              <EInput
                value={draft.supplier}
                onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
              />
            </EField>
            <EField label="Unit cost ($, optional)">
              <EInput
                type="number"
                min={0}
                step="0.01"
                value={draft.unitCost}
                onChange={(e) => setDraft({ ...draft, unitCost: e.target.value })}
              />
            </EField>
          </div>
          <EButton className="w-full" variant="gold" onClick={saveDraft} disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add item"}
          </EButton>
        </div>
      </EModal>
    </div>
  );
}
