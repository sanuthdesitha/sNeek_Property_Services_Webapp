"use client";

/**
 * Estate-native "Price book" section — the v1 admin pricebook editor
 * (components/admin/pricebook-editor.tsx) ported to v2. These rows still drive
 * the public quote wizard's add-on prices (quote-wizard.tsx submits them), so
 * this reuses the existing v1 endpoints verbatim:
 *   GET   /api/admin/pricebook       → PriceBook[] (jobType, bedrooms,
 *                                      bathrooms, baseRate, addOns, isActive)
 *   PATCH /api/admin/pricebook/[id]  { baseRate, addOns, isActive }  per row
 *
 * The add-on grid is the v1 key union: every key v1 always exposed plus any
 * key already stored on a row — so a stored price can never become invisible
 * or uneditable. Untouched keys are NOT materialised as zeros before save
 * (matches v1: only keys the row already has, or that were edited, persist).
 */
import * as React from "react";
import { BookOpen, ChevronDown, Loader2, Save } from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESwitch } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type PricebookRow = {
  id: string;
  jobType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  baseRate: number;
  addOns: Record<string, number> | null;
  isActive: boolean;
};

/** The fixed key set v1 always rendered, even when a row had no stored value. */
const DEFAULT_ADDON_KEYS = [
  "minimumPrice",
  "additionalBedroom",
  "additionalBathroom",
  "largeKitchen",
  "oven",
  "grill",
  "rangehood",
  "fridge",
  "fridgeFull",
  "freezer",
  "dishwasher",
  "insideCupboards",
  "pantry",
  "smallBalcony",
  "largeBalcony",
  "interiorWindows",
  "exteriorWindows",
  "slidingGlassDoor",
  "blindsShutters",
  "wallSpotClean",
  "wallWashing",
  "ceilingFans",
  "airConditionerVents",
  "wardrobe",
  "garage",
  "deckPatio",
  "alfresco",
  "pergola",
  "carpetSteam",
  "changeBedsheets",
  "washDishes",
  "laundryLoad",
  "laundryFold",
  "laundryCloset",
  "rumpusRoom",
  "heavyMess",
  "sameDay",
  "furnished",
  "pets",
  "outdoorArea",
  "additionalFloor",
  "streetParking",
  "limitedParking",
  "standardWindowAccess",
  "extensiveWindows",
] as const;

/** "airConditionerVents" → "Air conditioner vents" (raw key stays as the hint). */
function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function jobTypeLabel(jobType: string): string {
  return jobType.replace(/_/g, " ");
}

export function PricebookSection({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = React.useState<PricebookRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  // Track edits so admins can see which rows still need a per-row save.
  const [dirtyIds, setDirtyIds] = React.useState<ReadonlySet<string>>(new Set());
  const [expandedIds, setExpandedIds] = React.useState<ReadonlySet<string>>(new Set());

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pricebook", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Could not load price book",
          description: body.error ?? "Retry.",
          variant: "destructive",
        });
        return;
      }
      setRows(Array.isArray(body) ? body : []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Same union v1 built: fixed defaults + every key any row already stores.
  const addOnKeys = React.useMemo(
    () =>
      Array.from(
        new Set([...DEFAULT_ADDON_KEYS, ...rows.flatMap((row) => Object.keys(row.addOns ?? {}))])
      ).sort(),
    [rows]
  );

  function patchRow(id: string, patch: Partial<PricebookRow>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setDirtyIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function patchAddOn(row: PricebookRow, key: string, value: number) {
    patchRow(row.id, { addOns: { ...(row.addOns ?? {}), [key]: value } });
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveRow(row: PricebookRow) {
    if (!canEdit) return;
    setSavingId(row.id);
    try {
      const res = await fetch(`/api/admin/pricebook/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRate: row.baseRate,
          addOns: row.addOns ?? {},
          isActive: row.isActive,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Save failed",
          description: body.error ?? "Could not update price row.",
          variant: "destructive",
        });
        return;
      }
      setDirtyIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      toast({ title: `${jobTypeLabel(row.jobType)} price row updated` });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
          <BookOpen className="h-4 w-4" />
        </span>
        <div>
          <EEyebrow>Price book</EEyebrow>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Base rates and add-on prices behind the public quote wizard. Save each row after editing.
          </p>
        </div>
      </div>

      {!canEdit ? (
        <EAlert tone="info" title="Read-only">
          Only admins can change price book rows. Values below are view-only.
        </EAlert>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading price book…
        </div>
      ) : rows.length === 0 ? (
        <EAlert tone="info" title="No price book rows found">
          Quote add-on pricing has nothing to draw from until rows exist.
        </EAlert>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const expanded = expandedIds.has(row.id);
            const dirty = dirtyIds.has(row.id);
            const busy = savingId === row.id;
            return (
              <ECard key={row.id}>
                <ECardBody className="space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-[550]">{jobTypeLabel(row.jobType)}</span>
                      <EBadge tone="neutral" soft>
                        {row.bedrooms ?? "–"}bd / {row.bathrooms ?? "–"}ba
                      </EBadge>
                      {!row.isActive ? (
                        <EBadge tone="warning" soft>
                          Inactive
                        </EBadge>
                      ) : null}
                      {dirty ? (
                        <EBadge tone="info" soft>
                          Unsaved
                        </EBadge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                        Base
                        <span>$</span>
                        <EInput
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.baseRate}
                          disabled={!canEdit || busy}
                          className="h-9 w-28 text-right"
                          onChange={(e) => patchRow(row.id, { baseRate: Number(e.target.value || 0) })}
                        />
                      </label>
                      <ESwitch
                        checked={row.isActive}
                        disabled={!canEdit || busy}
                        onCheckedChange={(value) => patchRow(row.id, { isActive: value })}
                        label="Active"
                      />
                      <EButton
                        size="sm"
                        variant="outline"
                        onClick={() => toggleExpanded(row.id)}
                        aria-expanded={expanded}
                      >
                        <ChevronDown
                          className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
                        />
                        Add-ons
                      </EButton>
                      {canEdit ? (
                        <EButton size="sm" onClick={() => void saveRow(row)} disabled={busy}>
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          {busy ? "Saving…" : "Save"}
                        </EButton>
                      ) : null}
                    </div>
                  </div>

                  {expanded ? (
                    <div className="grid gap-3 border-t border-[hsl(var(--e-border))] pt-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                      {addOnKeys.map((key) => (
                        <EField key={key} label={humanizeKey(key)} hint={key}>
                          <div className="flex items-center gap-1">
                            <span className="text-[hsl(var(--e-muted-foreground))]">$</span>
                            <EInput
                              type="number"
                              min={0}
                              step="0.01"
                              className="h-9"
                              value={row.addOns?.[key] ?? 0}
                              disabled={!canEdit || busy}
                              onChange={(e) => patchAddOn(row, key, Number(e.target.value || 0))}
                            />
                          </div>
                        </EField>
                      ))}
                    </div>
                  ) : null}
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}
    </section>
  );
}
