"use client";

/**
 * ESTATE stock counts — v2-native list + lifecycle for stock-count runs.
 * Same endpoints (apiBase = /api/admin/stock-runs):
 *   GET   {apiBase}                → { properties, runs, canEditThresholds, canApply }
 *   POST  {apiBase}               { propertyId, title?, notes? }        (new run)
 *   PATCH {apiBase}/[id]          { status } / { apply:true } / { status:"DISCARDED" }
 *   PATCH {apiBase}/[id]          { lines:[{ id, countedOnHand, parLevel?, reorderThreshold?, note? }], status? }
 * Entering counted quantities per line is now a native Estate count-sheet EModal
 * (GET the run → edit lines → PATCH lines + submit).
 */
import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EStatCard } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  EModal,
  ESelect,
  ETableShell,
} from "@/components/v2/admin/estate-kit";

const API_BASE = "/api/admin/stock-runs";

type RunStatus = "DRAFT" | "ACTIVE" | "SUBMITTED" | "APPLIED" | "DISCARDED";
type RunSummary = {
  id: string;
  title: string;
  status: RunStatus;
  property: { id: string; name: string; suburb: string };
  requestedBy: { name: string | null; email: string };
  updatedAt: string;
  _count: { lines: number };
};
type PropertyOption = { id: string; name: string; suburb: string };
type Listing = {
  properties: PropertyOption[];
  runs: RunSummary[];
  canEditThresholds: boolean;
  canApply: boolean;
};

type CountLine = {
  id: string;
  item: { id: string; name: string; unit: string; category: string } | null;
  expectedOnHand: number;
  countedOnHand: number | null;
  parLevel: number | null;
  reorderThreshold: number | null;
  note: string | null;
  currentOnHand: number;
  currentParLevel: number;
  currentReorderThreshold: number;
};
type RunDetail = {
  id: string;
  title: string;
  status: RunStatus;
  property: { id: string; name: string; suburb: string };
  lines: CountLine[];
};

const STATUS_TONE: Record<RunStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "info",
  SUBMITTED: "warning",
  APPLIED: "success",
  DISCARDED: "danger",
};
const fmt = (v: string) => new Date(v).toLocaleDateString("en-AU", { day: "2-digit", month: "short" });

export function EstateStockRuns() {
  const [listing, setListing] = useState<Listing>({
    properties: [],
    runs: [],
    canEditThresholds: false,
    canApply: false,
  });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  // Native count sheet
  const [sheet, setSheet] = useState<RunDetail | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [drafts, setDrafts] = useState<
    Record<string, { counted: string; par: string; threshold: string; note: string }>
  >({});

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(API_BASE);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Stock runs failed", description: body.error, variant: "destructive" });
        return;
      }
      setListing({
        properties: body.properties ?? [],
        runs: body.runs ?? [],
        canEditThresholds: Boolean(body.canEditThresholds),
        canApply: Boolean(body.canApply),
      });
      if (!propertyId && body.properties?.[0]) setPropertyId(body.properties[0].id);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(
    () => ({
      open: listing.runs.filter((r) => ["DRAFT", "ACTIVE", "SUBMITTED"].includes(r.status)).length,
      total: listing.runs.length,
    }),
    [listing.runs],
  );

  async function createRun() {
    if (!propertyId) {
      toast({ title: "Property required", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, title: title.trim() || undefined, notes: notes.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Create failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: "Stock count started" });
      setShowNew(false);
      setTitle("");
      setNotes("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(run: RunSummary, patch: object, msg: string) {
    setBusyId(run.id);
    try {
      const res = await fetch(`${API_BASE}/${run.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: msg });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function hydrateSheet(detail: RunDetail) {
    setSheet(detail);
    const next: Record<string, { counted: string; par: string; threshold: string; note: string }> = {};
    for (const line of detail.lines) {
      next[line.id] = {
        counted: line.countedOnHand == null ? "" : String(line.countedOnHand),
        par: line.parLevel == null ? String(line.currentParLevel ?? "") : String(line.parLevel),
        threshold:
          line.reorderThreshold == null
            ? String(line.currentReorderThreshold ?? "")
            : String(line.reorderThreshold),
        note: line.note ?? "",
      };
    }
    setDrafts(next);
  }

  async function openSheet(run: RunSummary) {
    setSheetLoading(true);
    setSheet({ id: run.id, title: run.title, status: run.status, property: run.property, lines: [] });
    try {
      const res = await fetch(`${API_BASE}/${run.id}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not open count", description: body.error, variant: "destructive" });
        setSheet(null);
        return;
      }
      hydrateSheet(body as RunDetail);
    } finally {
      setSheetLoading(false);
    }
  }

  function sheetLinesPayload() {
    if (!sheet) return [];
    return sheet.lines.map((line) => {
      const d = drafts[line.id] ?? { counted: "", par: "", threshold: "", note: "" };
      return {
        id: line.id,
        countedOnHand: d.counted.trim() === "" ? null : Number(d.counted),
        ...(listing.canEditThresholds
          ? {
              parLevel: d.par.trim() === "" ? null : Number(d.par),
              reorderThreshold: d.threshold.trim() === "" ? null : Number(d.threshold),
            }
          : {}),
        note: d.note.trim() || null,
      };
    });
  }

  async function saveSheet(submit: boolean) {
    if (!sheet) return;
    const readOnly = sheet.status === "APPLIED" || sheet.status === "DISCARDED";
    if (readOnly) {
      setSheet(null);
      return;
    }
    setSheetSaving(true);
    try {
      const patch: Record<string, unknown> = { lines: sheetLinesPayload() };
      // Advance the lifecycle: a fresh DRAFT becomes ACTIVE on first save; an
      // explicit submit moves it to SUBMITTED (ready to apply).
      if (submit) patch.status = "SUBMITTED";
      else if (sheet.status === "DRAFT") patch.status = "ACTIVE";

      const res = await fetch(`${API_BASE}/${sheet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Save failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: submit ? "Count submitted" : "Count saved" });
      if (submit) {
        setSheet(null);
      } else if (body?.lines) {
        hydrateSheet(body as RunDetail);
      }
      await load();
    } finally {
      setSheetSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <section className="grid grid-cols-2 gap-4">
          <EStatCard label="Open counts" value={totals.open} icon={<ClipboardList className="h-4 w-4" />} />
          <EStatCard label="All counts" value={totals.total} icon={<ClipboardList className="h-4 w-4" />} />
        </section>
        <EButton size="sm" variant="gold" onClick={() => setShowNew(true)}>
          <Plus className="h-3.5 w-3.5" /> New count
        </EButton>
      </div>

      <ECard className="overflow-hidden p-0">
        {loading ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : listing.runs.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No stock counts yet.
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Count" },
              { label: "Property" },
              { label: "Lines", align: "center" },
              { label: "Status", align: "center" },
              { label: "", align: "right" },
            ]}
          >
            {listing.runs.map((run) => {
              const readOnly = run.status === "APPLIED" || run.status === "DISCARDED";
              return (
                <tr key={run.id} className="hover:bg-[hsl(var(--e-surface-raised))]">
                  <td className="px-4 py-3">
                    <span className="font-[550] text-[hsl(var(--e-foreground))]">{run.title}</span>
                    <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                      {run.requestedBy.name ?? run.requestedBy.email} · {fmt(run.updatedAt)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {run.property.name}
                    <span className="text-[hsl(var(--e-text-faint))]"> · {run.property.suburb}</span>
                  </td>
                  <td className="px-4 py-3 text-center e-tnum text-[hsl(var(--e-muted-foreground))]">
                    {run._count.lines}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <EBadge tone={STATUS_TONE[run.status]} soft>
                      {run.status}
                    </EBadge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <EButton size="sm" variant="outline" onClick={() => openSheet(run)}>
                        {readOnly ? "View sheet" : "Open sheet"}
                      </EButton>
                      {run.status === "SUBMITTED" && listing.canApply ? (
                        <EButton
                          size="sm"
                          variant="outline-gold"
                          disabled={busyId === run.id}
                          onClick={() => setStatus(run, { apply: true }, "Count applied to inventory")}
                        >
                          Apply
                        </EButton>
                      ) : null}
                      {!readOnly ? (
                        <EButton
                          size="sm"
                          variant="ghost"
                          className="text-[hsl(var(--e-danger))]"
                          disabled={busyId === run.id}
                          onClick={() => setStatus(run, { status: "DISCARDED" }, "Count discarded")}
                        >
                          Discard
                        </EButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </ETableShell>
        )}
      </ECard>

      <EModal open={showNew} onClose={() => setShowNew(false)} eyebrow="Inventory" title="Start stock count">
        <div className="space-y-4">
          <EField label="Property">
            <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">Select property…</option>
              {listing.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.suburb}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Title (optional)">
            <EInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. July count" />
          </EField>
          <EField label="Notes (optional)">
            <EInput value={notes} onChange={(e) => setNotes(e.target.value)} />
          </EField>
          <EButton className="w-full" variant="gold" onClick={createRun} disabled={creating || !propertyId}>
            {creating ? "Starting…" : "Start count"}
          </EButton>
        </div>
      </EModal>

      <EModal
        open={Boolean(sheet)}
        onClose={() => setSheet(null)}
        eyebrow={sheet ? `${sheet.property.name} · ${sheet.property.suburb}` : "Count sheet"}
        title={sheet ? `Count sheet — ${sheet.title}` : "Count sheet"}
        wide
      >
        {(() => {
          if (!sheet) return null;
          const readOnly = sheet.status === "APPLIED" || sheet.status === "DISCARDED";
          if (sheetLoading && sheet.lines.length === 0) {
            return (
              <p className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                Loading count sheet…
              </p>
            );
          }
          if (sheet.lines.length === 0) {
            return (
              <p className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                This count has no lines yet.
              </p>
            );
          }
          return (
            <div className="space-y-4">
              <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                Enter counted on-hand per item.
                {listing.canEditThresholds ? " Par & reorder thresholds are editable." : ""} Saving keeps
                the count open; submitting readies it to apply.
              </p>
              <ETableShell
                headers={[
                  { label: "Item" },
                  { label: "On hand", align: "center" },
                  { label: "Counted", align: "center" },
                  ...(listing.canEditThresholds
                    ? [{ label: "Par", align: "center" as const }, { label: "Reorder", align: "center" as const }]
                    : []),
                  { label: "Note" },
                ]}
              >
                {sheet.lines.map((line) => {
                  const d = drafts[line.id] ?? { counted: "", par: "", threshold: "", note: "" };
                  const patch = (p: Partial<typeof d>) =>
                    setDrafts((prev) => ({ ...prev, [line.id]: { ...d, ...p } }));
                  return (
                    <tr key={line.id}>
                      <td className="px-4 py-2.5">
                        <span className="font-[550] text-[hsl(var(--e-foreground))]">
                          {line.item?.name ?? "Item"}
                        </span>
                        <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {line.item?.category ?? ""} · per {line.item?.unit ?? "unit"}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-center e-tnum text-[hsl(var(--e-muted-foreground))]">
                        {line.currentOnHand}
                      </td>
                      <td className="px-4 py-2.5">
                        <EInput
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={readOnly}
                          value={d.counted}
                          onChange={(e) => patch({ counted: e.target.value })}
                          className="mx-auto h-8 w-20 text-center"
                        />
                      </td>
                      {listing.canEditThresholds ? (
                        <>
                          <td className="px-4 py-2.5">
                            <EInput
                              type="number"
                              min={0}
                              step="0.01"
                              disabled={readOnly}
                              value={d.par}
                              onChange={(e) => patch({ par: e.target.value })}
                              className="mx-auto h-8 w-16 text-center"
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <EInput
                              type="number"
                              min={0}
                              step="0.01"
                              disabled={readOnly}
                              value={d.threshold}
                              onChange={(e) => patch({ threshold: e.target.value })}
                              className="mx-auto h-8 w-16 text-center"
                            />
                          </td>
                        </>
                      ) : null}
                      <td className="px-4 py-2.5">
                        <EInput
                          disabled={readOnly}
                          value={d.note}
                          onChange={(e) => patch({ note: e.target.value })}
                          placeholder="—"
                          className="h-8"
                        />
                      </td>
                    </tr>
                  );
                })}
              </ETableShell>
              <div className="flex items-center justify-end gap-2">
                <EButton variant="outline" size="sm" onClick={() => setSheet(null)}>
                  {readOnly ? "Close" : "Cancel"}
                </EButton>
                {!readOnly ? (
                  <>
                    <EButton
                      variant="outline-gold"
                      size="sm"
                      disabled={sheetSaving}
                      onClick={() => saveSheet(false)}
                    >
                      {sheetSaving ? "Saving…" : "Save progress"}
                    </EButton>
                    <EButton variant="gold" size="sm" disabled={sheetSaving} onClick={() => saveSheet(true)}>
                      Submit count
                    </EButton>
                  </>
                ) : null}
              </div>
            </div>
          );
        })()}
      </EModal>
    </div>
  );
}
