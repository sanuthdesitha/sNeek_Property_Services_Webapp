"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { toast } from "@/hooks/use-toast";

type RunSummary = {
  id: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "SUBMITTED" | "APPLIED" | "DISCARDED";
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
  status: "DRAFT" | "ACTIVE" | "SUBMITTED" | "APPLIED" | "DISCARDED";
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

function numberValue(value: string, fallback: number | null = null) {
  if (value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function StockRunWorkspace({
  apiBase,
  title,
  description,
}: {
  apiBase: string;
  title: string;
  description: string;
}) {
  const [listing, setListing] = useState<ListingResponse>({ properties: [], runs: [], canEditThresholds: false, canApply: false });
  const [selectedRunId, setSelectedRunId] = useState("");
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRun, setLoadingRun] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newPropertyId, setNewPropertyId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [draftLines, setDraftLines] = useState<Record<string, { countedOnHand: string; parLevel: string; reorderThreshold: string; note: string }>>({});

  async function loadListing() {
    setLoading(true);
    const res = await fetch(apiBase, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast({ title: "Stock runs failed", description: body.error ?? "Could not load stock runs.", variant: "destructive" });
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
      toast({ title: "Stock run failed", description: body.error ?? "Could not load stock run.", variant: "destructive" });
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
  }, [apiBase]);

  useEffect(() => {
    void loadRun(selectedRunId);
  }, [apiBase, selectedRunId]);

  const groupedLines = useMemo(() => {
    if (!run) return [];
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
      toast({ title: "Create failed", description: body.error ?? "Could not create stock run.", variant: "destructive" });
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
    if (action === "DISCARDED") {
      setDiscardConfirmOpen(false);
    }
    if (!res.ok) {
      toast({ title: "Save failed", description: body.error ?? "Could not update stock run.", variant: "destructive" });
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" onClick={() => void loadListing()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Start a stock count</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr_auto]">
          <select
            className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm"
            value={newPropertyId}
            onChange={(event) => setNewPropertyId(event.target.value)}
          >
            <option value="">Select property</option>
            {listing.properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name} - {property.suburb}
              </option>
            ))}
          </select>
          <Input placeholder="Run title (optional)" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <Input placeholder="Notes (optional)" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
          <Button onClick={createRun} disabled={creating}>
            <ClipboardList className="mr-2 h-4 w-4" />
            {creating ? "Starting..." : "Start"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading runs...</p>
            ) : listing.runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock counts yet.</p>
            ) : (
              listing.runs.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`w-full rounded-xl border px-3 py-3 text-left text-sm transition ${
                    selectedRunId === row.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedRunId(row.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{row.title}</span>
                    <span className="text-xs text-muted-foreground">{row.status.replace(/_/g, " ")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.property.name} · {row._count.lines} lines
                  </p>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingRun ? (
              <p className="text-sm text-muted-foreground">Loading stock run...</p>
            ) : !run ? (
              <p className="text-sm text-muted-foreground">Select a stock run to begin.</p>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    value={run.title}
                    disabled={runIsReadOnly}
                    onChange={(e) => setRun((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  />
                  <Input value={`${run.property.name} - ${run.property.suburb}`} disabled />
                </div>
                <Textarea
                  rows={3}
                  disabled={runIsReadOnly}
                  value={run.notes ?? ""}
                  onChange={(e) => setRun((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                  placeholder="Run notes"
                />
                {run.status === "DISCARDED" ? (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    This stock count was discarded. It stays here for reference only and cannot be edited or applied.
                  </p>
                ) : null}

                {groupedLines.map(([category, lines]) => (
                  <div key={category} className="space-y-3 rounded-2xl border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold">{category}</h3>
                      <span className="text-xs text-muted-foreground">{lines.length} items</span>
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
                          <div key={line.id} className="rounded-xl border p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="font-medium">{line.item.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  Expected {line.expectedOnHand} {line.item.unit}
                                  {line.item.supplier ? ` · ${line.item.supplier}` : ""}
                                </p>
                              </div>
                              <div className="grid grid-cols-3 gap-2 sm:w-auto">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  disabled={runIsReadOnly}
                                  value={draft.countedOnHand}
                                  onChange={(e) =>
                                    setDraftLines((prev) => ({
                                      ...prev,
                                      [line.id]: { ...draft, countedOnHand: e.target.value },
                                    }))
                                  }
                                />
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  disabled={!run.canEditThresholds || runIsReadOnly}
                                  value={draft.parLevel}
                                  onChange={(e) =>
                                    setDraftLines((prev) => ({
                                      ...prev,
                                      [line.id]: { ...draft, parLevel: e.target.value },
                                    }))
                                  }
                                />
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  disabled={!run.canEditThresholds || runIsReadOnly}
                                  value={draft.reorderThreshold}
                                  onChange={(e) =>
                                    setDraftLines((prev) => ({
                                      ...prev,
                                      [line.id]: { ...draft, reorderThreshold: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                            </div>
                            <div className="mt-2">
                              <Textarea
                                rows={2}
                                placeholder="Notes"
                                disabled={runIsReadOnly}
                                value={draft.note}
                                onChange={(e) =>
                                  setDraftLines((prev) => ({
                                    ...prev,
                                    [line.id]: { ...draft, note: e.target.value },
                                  }))
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
                  <Button variant="outline" onClick={() => void saveRun()} disabled={saving || runIsReadOnly}>
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  {run.status !== "SUBMITTED" && !runIsReadOnly ? (
                    <Button onClick={() => void saveRun("SUBMITTED")} disabled={saving}>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Submit
                    </Button>
                  ) : null}
                  {run.canApply && run.status === "SUBMITTED" ? (
                    <Button onClick={() => void saveRun("APPLIED")} disabled={saving}>
                      Apply to inventory
                    </Button>
                  ) : null}
                  {run.canApply && !runIsReadOnly ? (
                    <Button variant="destructive" onClick={() => setDiscardConfirmOpen(true)} disabled={saving}>
                      Discard
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <TwoStepConfirmDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        title="Discard stock count"
        description="This keeps the stock count for reference but prevents it from being edited or applied to inventory."
        actionKey="discardStockRun"
        confirmLabel="Discard stock count"
        loading={saving}
        onConfirm={() => void saveRun("DISCARDED")}
      />
    </div>
  );
}
