"use client";

/**
 * ESTATE stock counts — v2-native list + lifecycle for stock-count runs.
 * Same endpoints (apiBase = /api/admin/stock-runs):
 *   GET   {apiBase}                → { properties, runs, canEditThresholds, canApply }
 *   POST  {apiBase}               { propertyId, title?, notes? }        (new run)
 *   PATCH {apiBase}/[id]          { status } / { apply:true } / { status:"DISCARDED" }
 * Entering counted quantities per line is a deep flow → open the run in the
 * classic count sheet via an EClassicLink.
 */
import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EStatCard } from "@/components/v2/ui/primitives";
import {
  EClassicLink,
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
                      <EClassicLink href="/admin/inventory?tab=stock-counts">Open sheet</EClassicLink>
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
    </div>
  );
}
