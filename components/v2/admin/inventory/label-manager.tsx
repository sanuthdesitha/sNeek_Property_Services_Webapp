"use client";

/**
 * GENERATING AND PRINTING SHELF LABELS.
 *
 * Two jobs on one screen, in the order they actually happen: mint labels for
 * the items you care about, then print the ones you select.
 *
 * PRINTING IS A SELECTION, not "print everything". Setting up a new property
 * means printing forty labels at once; replacing one that fell off means
 * printing exactly one. A screen that only did the first would have people
 * printing a full sheet and binning thirty-nine.
 *
 * Generation deliberately SKIPS items that already have a label for the chosen
 * scope, and says so. Re-minting would orphan every tag already stuck to a
 * shelf: the printed one stops resolving, and nobody finds out until a cleaner
 * scans it and gets nothing back.
 */

import * as React from "react";
import { Printer, QrCode, Barcode as BarcodeIcon, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { LabelSheet, type PrintableLabel } from "@/components/v2/inventory/label-sheet";
import type { BarcodeSymbology } from "@/lib/inventory/label-codes";

interface LabelRow {
  id: string;
  code: string;
  packSize: number;
  isActive: boolean;
  item: { id: string; name: string; unit: string | null; category: string | null };
  property: { id: string; name: string; suburb: string | null } | null;
}

interface ItemRow {
  id: string;
  name: string;
  category: string;
  unit: string;
}

export function LabelManager({ properties }: { properties: Array<{ id: string; name: string }> }) {
  const [labels, setLabels] = React.useState<LabelRow[]>([]);
  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [scope, setScope] = React.useState<string>("GENERAL");
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(new Set());
  const [selectedLabels, setSelectedLabels] = React.useState<Set<string>>(new Set());
  const [symbology, setSymbology] = React.useState<BarcodeSymbology>("CODE128");
  const [layout, setLayout] = React.useState<"sheet" | "single">("sheet");
  const [busy, setBusy] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [labelRes, itemRes] = await Promise.all([
        fetch(`/api/admin/inventory/labels?propertyId=${encodeURIComponent(scope)}`),
        fetch("/api/admin/inventory/items"),
      ]);
      if (labelRes.ok) setLabels((await labelRes.json()).labels ?? []);
      if (itemRes.ok) {
        const body = await itemRes.json();
        setItems(Array.isArray(body) ? body : (body.items ?? []));
      }
    } catch {
      toast({ title: "Could not load labels" });
    } finally {
      setLoading(false);
    }
  }, [scope]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    if (selectedItems.size === 0) {
      toast({ title: "Pick at least one item" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/inventory/labels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemIds: Array.from(selectedItems),
          ...(scope !== "GENERAL" ? { propertyId: scope } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not generate.");

      toast({
        title: `${body.created?.length ?? 0} label${
          body.created?.length === 1 ? "" : "s"
        } generated`,
        description: body.message,
      });
      setSelectedItems(new Set());
      // Newly minted labels are pre-selected for printing: generating them and
      // then hunting through the list to tick the same ones is a pointless
      // second pass over a decision already made.
      const freshIds = new Set<string>((body.created ?? []).map((row: LabelRow) => row.id));
      await load();
      setSelectedLabels(freshIds);
    } catch (err: any) {
      toast({ title: "Could not generate labels", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  const visibleItems = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items
      .filter((item) => (needle ? item.name.toLowerCase().includes(needle) : true))
      .slice(0, 200);
  }, [items, search]);

  const printable: PrintableLabel[] = labels
    .filter((row) => selectedLabels.has(row.id))
    .map((row) => ({
      code: row.code,
      itemName: row.item.name,
      propertyName: row.property?.name ?? null,
      unit: row.item.unit,
    }));

  return (
    <div className="space-y-5">
      <ECard>
        <ECardHeader className="pb-2">
          <ECardTitle className="text-[0.95rem]">Generate labels</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-3 pt-0">
          <div className="flex flex-wrap gap-2">
            <EField
              label="Scope"
              hint="A pinned label means this item at this property. General works anywhere."
            >
              <ESelect
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setSelectedLabels(new Set());
                }}
              >
                <option value="GENERAL">General — any property</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Find an item">
              <EInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items…"
              />
            </EField>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
            {visibleItems.length === 0 ? (
              <p className="p-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                No items match.
              </p>
            ) : (
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {visibleItems.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedItems.has(item.id)}
                        onChange={() =>
                          setSelectedItems((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-[0.875rem]">{item.name}</span>
                      <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {item.unit}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <EButton variant="gold" onClick={generate} disabled={busy || selectedItems.size === 0}>
            <Plus className="h-3.5 w-3.5" />
            {busy
              ? "Generating…"
              : `Generate ${selectedItems.size || ""} label${selectedItems.size === 1 ? "" : "s"}`}
          </EButton>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader className="flex-row items-center justify-between pb-2">
          <ECardTitle className="text-[0.95rem]">
            Labels{" "}
            <span className="text-[0.75rem] font-normal text-[hsl(var(--e-muted-foreground))]">
              {selectedLabels.size} selected
            </span>
          </ECardTitle>
          <div className="flex flex-wrap gap-1.5">
            <EButton
              size="sm"
              variant={symbology === "CODE128" ? "gold" : "outline"}
              onClick={() => setSymbology("CODE128")}
            >
              <BarcodeIcon className="h-3.5 w-3.5" /> Barcode
            </EButton>
            <EButton
              size="sm"
              variant={symbology === "QR" ? "gold" : "outline"}
              onClick={() => setSymbology("QR")}
            >
              <QrCode className="h-3.5 w-3.5" /> QR
            </EButton>
          </div>
        </ECardHeader>
        <ECardBody className="space-y-3 pt-0">
          {loading ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
          ) : labels.length === 0 ? (
            <EEmptyState
              title="No labels here yet"
              description="Pick some items above and generate their labels."
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <EButton
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedLabels(new Set(labels.map((l) => l.id)))}
                >
                  Select all
                </EButton>
                <EButton size="sm" variant="outline" onClick={() => setSelectedLabels(new Set())}>
                  Clear
                </EButton>
                <EButton
                  size="sm"
                  variant={layout === "sheet" ? "gold" : "outline"}
                  onClick={() => setLayout("sheet")}
                >
                  Many per page
                </EButton>
                <EButton
                  size="sm"
                  variant={layout === "single" ? "gold" : "outline"}
                  onClick={() => setLayout("single")}
                >
                  One per page
                </EButton>
                <EButton
                  size="sm"
                  variant="gold"
                  disabled={printable.length === 0}
                  onClick={() => window.print()}
                >
                  <Printer className="h-3.5 w-3.5" /> Print {printable.length || ""}
                </EButton>
              </div>

              <ul className="max-h-72 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                {labels.map((row) => (
                  <li key={row.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedLabels.has(row.id)}
                        onChange={() =>
                          setSelectedLabels((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-[0.875rem]">
                        {row.item.name}
                      </span>
                      {row.property ? (
                        <EBadge tone="neutral" soft>
                          {row.property.name}
                        </EBadge>
                      ) : null}
                      <span className="font-mono text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                        {row.code}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </ECardBody>
      </ECard>

      {/* Rendered only when something is selected. The print stylesheet hides
          everything else on the page, so this is what comes out of the printer. */}
      {printable.length > 0 ? (
        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="text-[0.95rem]">Print preview</ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <LabelSheet labels={printable} symbology={symbology} layout={layout} />
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}
