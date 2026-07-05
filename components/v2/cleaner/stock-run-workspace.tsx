"use client";

/**
 * Estate cleaner stock-count workspace. Same endpoints + payloads as the live
 * workspace (components/inventory/stock-run-workspace.tsx):
 *   GET   {apiBase}                     → { properties, runs, canEditThresholds, canApply }
 *   POST  {apiBase}                     { propertyId, title, notes }        → { id }
 *   GET   {apiBase}/{runId}             → RunDetail
 *   PATCH {apiBase}/{runId}             { title, notes, status?, apply?, lines[] }
 * Discard uses the Estate EConfirmModal instead of the v1 two-step dialog.
 */
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, RefreshCw } from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { toast } from "@/hooks/use-toast";

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
type RunLine = {
  id: string;
  propertyStockId: string;
  expectedOnHand: number;
  countedOnHand: number | null;
  parLevel: number | null;
  reorderThreshold: number | null;
  note: string | null;
  item: { id: string; name: string; category: string; unit: string; supplier: string | null };
  currentOnHand: number;
  currentParLevel: number;
  currentReorderThreshold: number;
};
type RunDetail = {
  id: string;
  title: string;
  notes: string | null;
  status: RunStatus;
  property: { id: string; name: string; suburb: string };
  requestedBy: { name: string | null; email: string };
  canEditThresholds: boolean;
  canApply: boolean;
  lines: RunLine[];
};
type ListingResponse = {
  properties: PropertyOption[];
  runs: RunSummary[];
  canEditThresholds: boolean;
  canApply: boolean;
};

const STATUS_TONE: Record<RunStatus, "neutral" | "primary" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "primary",
  SUBMITTED: "warning",
  APPLIED: "success",
  DISCARDED: "danger",
};

function numberValue(value: string, fallback: number | null = null) {
  if (value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function StockRunWorkspace({ apiBase }: { apiBase: string }) {
  const [listing, setListing] = useState<ListingResponse>({
    properties: [],
    runs: [],
    canEditThresholds: false,
    canApply: false,
  });
  const [selectedRunId, setSelectedRunId] = useState("");
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRun, setLoadingRun] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newPropertyId, setNewPropertyId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [draftLines, setDraftLines] = useState<
    Record<string, { countedOnHand: string; parLevel: string; reorderThreshold: string; note: string }>
  >({});

  async function loadListing() {
    setLoading(true);
    const res = await fetch(apiBase, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast({ title: "Stock runs failed", description: body.error, variant: "destructive" });
      return;
    }
    setListing(body);
    if (!newPropertyId && Array.isArray(body.properties) && body.properties[0]?.id) {
      setNewPropertyId(body.properties[0].id);
    }
    if (!selectedRunId && Array.isArray(body.runs) && body.runs[0]?.id) {
      setSelectedRunId(body.runs[0].id);
    }
  }

  async function loadRun(runId: string) {
    if (!runId) {
      setRun(null);
      return;
    }
    setLoadingRun(true);
    const res = await fetch(`${apiBase}/${runId}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoadingRun(false);
    if (!res.ok) {
      toast({ title: "Stock run failed", description: body.error, variant: "destructive" });
      return;
    }
    setRun(body);
    setDraftLines(
      Object.fromEntries(
        (body.lines ?? []).map((line: RunLine) => [
          line.id,
          {
            countedOnHand: String(line.countedOnHand ?? line.expectedOnHand ?? 0),
            parLevel: String(line.parLevel ?? line.currentParLevel ?? 0),
            reorderThreshold: String(line.reorderThreshold ?? line.currentReorderThreshold ?? 0),
            note: line.note ?? "",
          },
        ])
      )
    );
  }

  useEffect(() => {
    void loadListing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);
  useEffect(() => {
    void loadRun(selectedRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, selectedRunId]);

  const groupedLines = useMemo(() => {
    if (!run) return [] as Array<[string, RunLine[]]>;
    return Object.entries(
      run.lines.reduce<Record<string, RunLine[]>>((acc, line) => {
        (acc[line.item.category || "General"] ||= []).push(line);
        return acc;
      }, {})
    );
  }, [run]);
  const runIsReadOnly = run?.status === "APPLIED" || run?.status === "DISCARDED";

  async function createRun() {
    if (!newPropertyId) {
      toast({ title: "Property required", variant: "destructive" });
      return;
    }
    setCreating(true);
    const res = await fetch(apiBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: newPropertyId, title: newTitle, notes: newNotes }),
    });
    const body = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) {
      toast({ title: "Create failed", description: body.error, variant: "destructive" });
      return;
    }
    toast({ title: "Stock run started" });
    setNewTitle("");
    setNewNotes("");
    await loadListing();
    setSelectedRunId(body.id);
  }

  async function saveRun(action?: "SUBMITTED" | "APPLIED" | "DISCARDED") {
    if (!run) return;
    setSaving(true);
    const res = await fetch(`${apiBase}/${run.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: run.title,
        notes: run.notes,
        status: action === "SUBMITTED" || action === "DISCARDED" ? action : undefined,
        apply: action === "APPLIED",
        lines: run.lines.map((line) => ({
          id: line.id,
          countedOnHand: numberValue(draftLines[line.id]?.countedOnHand ?? "", line.countedOnHand ?? line.expectedOnHand),
          parLevel: run.canEditThresholds ? numberValue(draftLines[line.id]?.parLevel ?? "", line.parLevel) : undefined,
          reorderThreshold: run.canEditThresholds
            ? numberValue(draftLines[line.id]?.reorderThreshold ?? "", line.reorderThreshold)
            : undefined,
          note: draftLines[line.id]?.note ?? "",
        })),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (action === "DISCARDED") setDiscardOpen(false);
    if (!res.ok) {
      toast({ title: "Save failed", description: body.error, variant: "destructive" });
      return;
    }
    toast({
      title:
        action === "APPLIED"
          ? "Stock count applied"
          : action === "DISCARDED"
          ? "Stock count discarded"
          : action === "SUBMITTED"
          ? "Stock count submitted"
          : "Stock run saved",
    });
    setRun(body);
    await loadListing();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Count actual stock levels on site and submit the run for admin review.
        </p>
        <EButton variant="outline" size="sm" onClick={() => void loadListing()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </EButton>
      </div>

      {/* Start a count */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Start a stock count</ECardTitle>
        </ECardHeader>
        <ECardBody className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr_auto] md:items-end">
          <EField label="Property">
            <ESelect value={newPropertyId} onChange={(e) => setNewPropertyId(e.target.value)}>
              <option value="">Select property</option>
              {listing.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} - {p.suburb}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Run title (optional)">
            <EInput value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </EField>
          <EField label="Notes (optional)">
            <EInput value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
          </EField>
          <EButton onClick={() => void createRun()} disabled={creating}>
            <ClipboardList className="h-4 w-4" /> {creating ? "Starting…" : "Start"}
          </EButton>
        </ECardBody>
      </ECard>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Runs list */}
        <ECard>
          <ECardHeader>
            <ECardTitle>Runs</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-2">
            {loading ? (
              <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading runs…</p>
            ) : listing.runs.length === 0 ? (
              <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No stock counts yet.</p>
            ) : (
              listing.runs.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedRunId(row.id)}
                  className={`w-full rounded-[var(--e-radius)] border px-3 py-3 text-left transition ${
                    selectedRunId === row.id
                      ? "border-[hsl(var(--e-border-gold)/0.5)] bg-[hsl(var(--e-gold-soft))]"
                      : "border-[hsl(var(--e-border))] hover:bg-[hsl(var(--e-muted))]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[0.875rem] font-[550]">{row.title}</span>
                    <EBadge tone={STATUS_TONE[row.status]} soft>
                      {row.status.replace(/_/g, " ")}
                    </EBadge>
                  </div>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {row.property.name} · {row._count.lines} lines
                  </p>
                </button>
              ))
            )}
          </ECardBody>
        </ECard>

        {/* Run detail */}
        <ECard>
          <ECardHeader>
            <ECardTitle>Run details</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-4">
            {loadingRun ? (
              <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading stock run…</p>
            ) : !run ? (
              <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Select a stock run to begin.</p>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <EField label="Title">
                    <EInput
                      value={run.title}
                      disabled={runIsReadOnly}
                      onChange={(e) => setRun((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                    />
                  </EField>
                  <EField label="Property">
                    <EInput value={`${run.property.name} - ${run.property.suburb}`} disabled />
                  </EField>
                </div>
                <EField label="Run notes">
                  <ETextarea
                    rows={3}
                    disabled={runIsReadOnly}
                    value={run.notes ?? ""}
                    onChange={(e) => setRun((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                    placeholder="Run notes"
                  />
                </EField>

                {run.status === "DISCARDED" ? (
                  <EAlert tone="warning">
                    This stock count was discarded. It stays here for reference only and cannot be edited or applied.
                  </EAlert>
                ) : null}

                {groupedLines.map(([category, lines]) => (
                  <div
                    key={category}
                    className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[0.9375rem] font-[550]">{category}</h3>
                      <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{lines.length} items</span>
                    </div>
                    <div className="space-y-3">
                      {lines.map((line) => {
                        const draft = draftLines[line.id] ?? {
                          countedOnHand: String(line.countedOnHand ?? line.expectedOnHand),
                          parLevel: String(line.parLevel ?? line.currentParLevel),
                          reorderThreshold: String(line.reorderThreshold ?? line.currentReorderThreshold),
                          note: line.note ?? "",
                        };
                        return (
                          <div
                            key={line.id}
                            className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-[0.875rem] font-[550]">{line.item.name}</p>
                                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                                  Expected {line.expectedOnHand} {line.item.unit}
                                  {line.item.supplier ? ` · ${line.item.supplier}` : ""}
                                </p>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <EInput
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  disabled={runIsReadOnly}
                                  value={draft.countedOnHand}
                                  onChange={(e) =>
                                    setDraftLines((prev) => ({ ...prev, [line.id]: { ...draft, countedOnHand: e.target.value } }))
                                  }
                                  aria-label="Counted on hand"
                                />
                                <EInput
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  disabled={!run.canEditThresholds || runIsReadOnly}
                                  value={draft.parLevel}
                                  onChange={(e) =>
                                    setDraftLines((prev) => ({ ...prev, [line.id]: { ...draft, parLevel: e.target.value } }))
                                  }
                                  aria-label="Par level"
                                />
                                <EInput
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  disabled={!run.canEditThresholds || runIsReadOnly}
                                  value={draft.reorderThreshold}
                                  onChange={(e) =>
                                    setDraftLines((prev) => ({ ...prev, [line.id]: { ...draft, reorderThreshold: e.target.value } }))
                                  }
                                  aria-label="Reorder threshold"
                                />
                              </div>
                            </div>
                            <div className="mt-2">
                              <ETextarea
                                rows={2}
                                placeholder="Notes"
                                disabled={runIsReadOnly}
                                value={draft.note}
                                onChange={(e) =>
                                  setDraftLines((prev) => ({ ...prev, [line.id]: { ...draft, note: e.target.value } }))
                                }
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2">
                  <EButton variant="outline" onClick={() => void saveRun()} disabled={saving || runIsReadOnly}>
                    {saving ? "Saving…" : "Save"}
                  </EButton>
                  {run.status !== "SUBMITTED" && !runIsReadOnly ? (
                    <EButton variant="gold" onClick={() => void saveRun("SUBMITTED")} disabled={saving}>
                      <CheckCircle2 className="h-4 w-4" /> Submit
                    </EButton>
                  ) : null}
                  {run.canApply && run.status === "SUBMITTED" ? (
                    <EButton onClick={() => void saveRun("APPLIED")} disabled={saving}>
                      Apply to inventory
                    </EButton>
                  ) : null}
                  {run.canApply && !runIsReadOnly ? (
                    <EButton variant="danger" onClick={() => setDiscardOpen(true)} disabled={saving}>
                      Discard
                    </EButton>
                  ) : null}
                </div>
              </>
            )}
          </ECardBody>
        </ECard>
      </div>

      <EConfirmModal
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard stock count"
        description="This keeps the stock count for reference but prevents it from being edited or applied to inventory."
        confirmLabel="Discard stock count"
        loading={saving}
        onConfirm={() => void saveRun("DISCARDED")}
      />
    </div>
  );
}
