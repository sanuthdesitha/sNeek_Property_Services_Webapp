"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Printer, RotateCcw, Save, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";

type ShoppingRow = {
  propertyId: string;
  propertyName: string;
  suburb: string;
  item: { id: string; name: string; category: string; unit: string; supplier: string | null };
  onHand: number;
  parLevel: number;
  reorderThreshold: number;
  needed: number;
  estimatedUnitCost?: number | null;
};
type PropertyOption = { id: string; name: string; suburb: string };
type PropertySummary = { propertyId: string; propertyName: string; suburb: string; lineCount: number; totalNeededUnits: number; emergencyCount: number; estimatedCost?: number };
type Payload = { rows: ShoppingRow[]; properties: PropertyOption[]; propertySummaries: PropertySummary[] };
type DraftRow = { include: boolean; plannedQty: number; purchased: boolean; note: string };
type RunStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED";
type SavedRun = {
  id: string;
  name: string;
  status: RunStatus;
  planningScope: string;
  updatedAt: string;
  rows: Array<{ propertyId: string; itemId: string; plannedQty: number; include: boolean; purchased: boolean; note?: string }>;
};

type Props = {
  mode: "client" | "cleaner";
  apiPath: string;
  runsApiBase: string;
  initialPropertyId?: string;
  title?: string;
  description?: string;
};

const money = (n: number) => `$${n.toFixed(2)}`;
const rowKey = (row: ShoppingRow) => `${row.propertyId}::${row.item.id}`;
const priorityForRow = (row: ShoppingRow) => {
  if (row.onHand <= 0) return { label: "Emergency" as const, score: 3 };
  if (row.onHand <= row.reorderThreshold) {
    if (row.needed >= 3 || row.onHand <= Math.max(1, Math.floor(row.reorderThreshold / 2))) return { label: "Emergency" as const, score: 3 };
    return { label: "High" as const, score: 2 };
  }
  return { label: "Medium" as const, score: 1 };
};

export function ShoppingPlanner({ mode, apiPath, runsApiBase, initialPropertyId, title, description }: Props) {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<Payload>({ rows: [], properties: [], propertySummaries: [] });
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [propertyId, setPropertyId] = useState(initialPropertyId ?? "all");
  const [capacityUnits, setCapacityUnits] = useState("");
  const [view, setView] = useState<"by-property" | "combined">(mode === "cleaner" ? "combined" : "by-property");

  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [runName, setRunName] = useState("Shopping Run");
  const [runStatus, setRunStatus] = useState<RunStatus>("DRAFT");
  const [savingRun, setSavingRun] = useState(false);
  const [deletingRun, setDeletingRun] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const qs = propertyId !== "all" ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
      const res = await fetch(`${apiPath}${qs}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load shopping plan.");
      const rows: ShoppingRow[] = Array.isArray(body.rows) ? body.rows : [];
      const properties: PropertyOption[] = Array.isArray(body.properties) ? body.properties : [];
      const propertySummaries: PropertySummary[] = Array.isArray(body.propertySummaries) ? body.propertySummaries : [];
      setPayload({ rows, properties, propertySummaries });
      setDrafts((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          const key = rowKey(row);
          if (!next[key]) next[key] = { include: true, plannedQty: Math.max(0, row.needed), purchased: false, note: "" };
        }
        return next;
      });
    } catch (err: any) {
      toast({ title: "Shopping planner failed", description: err.message ?? "Could not load.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function loadRuns() {
    setLoadingRuns(true);
    try {
      const res = await fetch(runsApiBase);
      const body = await res.json().catch(() => []);
      if (!res.ok) throw new Error((body as any)?.error ?? "Could not load runs.");
      setRuns(Array.isArray(body) ? (body as SavedRun[]) : []);
    } catch (err: any) {
      toast({ title: "Run list failed", description: err.message ?? "Could not load runs.", variant: "destructive" });
    } finally {
      setLoadingRuns(false);
    }
  }

  useEffect(() => { loadData(); /* eslint-disable-next-line */ }, [propertyId, apiPath]);
  useEffect(() => { loadRuns(); /* eslint-disable-next-line */ }, [runsApiBase]);

  const enrichedRows = useMemo(() => {
    return payload.rows.map((row) => {
      const key = rowKey(row);
      const draft = drafts[key] ?? { include: true, plannedQty: row.needed, purchased: false, note: "" };
      const priority = priorityForRow(row);
      const plannedQty = Math.max(0, Number(draft.plannedQty || 0));
      const estimatedLineCost = draft.include && row.estimatedUnitCost != null ? plannedQty * Number(row.estimatedUnitCost) : 0;
      return { row, key, draft, priority, estimatedLineCost };
    }).sort((a, b) => (b.priority.score - a.priority.score) || (b.row.needed - a.row.needed) || a.row.propertyName.localeCompare(b.row.propertyName) || a.row.item.name.localeCompare(b.row.item.name));
  }, [payload.rows, drafts]);

  const filteredRows = useMemo(() => propertyId === "all" ? enrichedRows : enrichedRows.filter((r) => r.row.propertyId === propertyId), [enrichedRows, propertyId]);
  const groupedByProperty = useMemo(() => filteredRows.reduce<Record<string, typeof filteredRows>>((acc, entry) => { (acc[entry.row.propertyId] ||= []).push(entry); return acc; }, {}), [filteredRows]);

  const summary = useMemo(() => {
    const selected = filteredRows.filter((r) => r.draft.include);
    return {
      lines: filteredRows.length,
      emergencyLines: filteredRows.filter((r) => r.priority.label === "Emergency").length,
      totalNeededUnits: filteredRows.reduce((s, r) => s + r.row.needed, 0),
      plannedUnits: selected.reduce((s, r) => s + Math.max(0, Number(r.draft.plannedQty || 0)), 0),
      purchasedLines: filteredRows.filter((r) => r.draft.purchased).length,
      estimatedTotal: selected.reduce((s, r) => s + r.estimatedLineCost, 0),
    };
  }, [filteredRows]);

  const supplierTotals = useMemo(() => {
    const map = new Map<string, { supplier: string; category: string; lines: number; units: number; total: number }>();
    for (const e of filteredRows) {
      const supplier = e.row.item.supplier ?? "Unknown";
      const key = `${e.row.item.category}||${supplier}`;
      if (!map.has(key)) map.set(key, { supplier, category: e.row.item.category, lines: 0, units: 0, total: 0 });
      const s = map.get(key)!;
      s.lines += 1;
      if (e.draft.include) { s.units += Math.max(0, Number(e.draft.plannedQty || 0)); s.total += e.estimatedLineCost; }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total || a.supplier.localeCompare(b.supplier));
  }, [filteredRows]);

  const combinedItems = useMemo(() => {
    const map = new Map<string, { itemId: string; itemName: string; category: string; supplier: string | null; unit: string; totalNeeded: number; totalPlanned: number; totalCost: number; properties: Array<{ propertyId: string; propertyName: string; suburb: string; needed: number; planned: number; priority: string; cost: number }> }>();
    for (const e of filteredRows) {
      const key = `${e.row.item.id}::${e.row.item.supplier ?? ""}`;
      if (!map.has(key)) map.set(key, { itemId: e.row.item.id, itemName: e.row.item.name, category: e.row.item.category, supplier: e.row.item.supplier, unit: e.row.item.unit, totalNeeded: 0, totalPlanned: 0, totalCost: 0, properties: [] });
      const g = map.get(key)!;
      g.totalNeeded += e.row.needed;
      if (e.draft.include) { g.totalPlanned += Number(e.draft.plannedQty || 0); g.totalCost += e.estimatedLineCost; }
      g.properties.push({ propertyId: e.row.propertyId, propertyName: e.row.propertyName, suburb: e.row.suburb, needed: e.row.needed, planned: e.draft.include ? Number(e.draft.plannedQty || 0) : 0, priority: e.priority.label, cost: e.estimatedLineCost });
    }
    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost || a.itemName.localeCompare(b.itemName));
  }, [filteredRows]);

  function updateDraft(key: string, patch: Partial<DraftRow>) {
    setDrafts((prev) => {
      const base: DraftRow = prev[key] ?? { include: true, plannedQty: 0, purchased: false, note: "" };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  }

  function resetPlan() {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const e of filteredRows) next[e.key] = { ...(next[e.key] ?? { note: "" }), include: true, plannedQty: e.row.needed, purchased: false, note: next[e.key]?.note ?? "" };
      return next;
    });
  }
  function emergencyOnly() {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const e of filteredRows) {
        const emergency = e.priority.label === "Emergency";
        next[e.key] = { ...(next[e.key] ?? { note: "" }), include: emergency, purchased: next[e.key]?.purchased ?? false, note: next[e.key]?.note ?? "", plannedQty: emergency ? Math.max(1, Math.min(e.row.needed, e.row.reorderThreshold || e.row.needed)) : 0 };
      }
      return next;
    });
  }
  function smallQuantitiesMode() {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const e of filteredRows) next[e.key] = { ...(next[e.key] ?? { note: "" }), include: true, purchased: next[e.key]?.purchased ?? false, note: next[e.key]?.note ?? "", plannedQty: e.row.needed > 0 ? Math.min(e.row.needed, 1) : 0 };
      return next;
    });
  }
  function applyCapacityLimit() {
    const cap = Number(capacityUnits || 0);
    if (!Number.isFinite(cap) || cap <= 0) return toast({ title: "Enter a valid space limit (units).", variant: "destructive" });
    let remaining = Math.floor(cap);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const e of filteredRows) {
        const alloc = Math.max(0, Math.min(e.row.needed, remaining));
        next[e.key] = { ...(next[e.key] ?? { note: "" }), include: alloc > 0, purchased: next[e.key]?.purchased ?? false, note: next[e.key]?.note ?? "", plannedQty: alloc };
        remaining -= alloc;
      }
      return next;
    });
    toast({ title: "Space limit applied", description: `Allocated up to ${Math.floor(cap)} unit(s) by priority.` });
  }

  function buildSaveRows() {
    return payload.rows.map((row) => {
      const d = drafts[rowKey(row)] ?? { include: true, plannedQty: row.needed, purchased: false, note: "" };
      const plannedQty = Math.max(0, Number(d.plannedQty || 0));
      return {
        propertyId: row.propertyId, propertyName: row.propertyName, suburb: row.suburb,
        itemId: row.item.id, itemName: row.item.name, category: row.item.category, supplier: row.item.supplier ?? null, unit: row.item.unit,
        onHand: row.onHand, parLevel: row.parLevel, reorderThreshold: row.reorderThreshold, needed: row.needed,
        plannedQty, include: !!d.include, purchased: !!d.purchased, note: d.note || undefined,
        priority: priorityForRow(row).label,
        estimatedUnitCost: row.estimatedUnitCost ?? null,
        estimatedLineCost: row.estimatedUnitCost == null ? null : plannedQty * Number(row.estimatedUnitCost),
      };
    });
  }

  function applyRun(run: SavedRun) {
    setSelectedRunId(run.id); setRunName(run.name); setRunStatus(run.status);
    if (run.planningScope && run.planningScope !== propertyId) setPropertyId(run.planningScope);
    const saved = new Map(run.rows.map((r) => [`${r.propertyId}::${r.itemId}`, r]));
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of payload.rows) {
        const match = saved.get(rowKey(row));
        if (!match) continue;
        next[rowKey(row)] = { include: !!match.include, plannedQty: Number(match.plannedQty || 0), purchased: !!match.purchased, note: match.note ?? "" };
      }
      return next;
    });
  }

  async function saveRun() {
    if (!runName.trim()) return toast({ title: "Enter a run name first.", variant: "destructive" });
    setSavingRun(true);
    try {
      const res = await fetch(runsApiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedRunId || undefined, name: runName.trim(), status: runStatus, planningScope: propertyId || "all", rows: buildSaveRows() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save run.");
      setSelectedRunId(body.id); setRunName(body.name ?? runName.trim()); setRunStatus(body.status ?? runStatus);
      toast({ title: selectedRunId ? "Shopping run updated" : "Shopping run saved" });
      loadRuns();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message ?? "Could not save run.", variant: "destructive" });
    } finally { setSavingRun(false); }
  }

  async function deleteRun() {
    if (!selectedRunId) return;
    if (!window.confirm("Delete this shopping run?")) return;
    setDeletingRun(true);
    try {
      const res = await fetch(`${runsApiBase}/${selectedRunId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not delete run.");
      toast({ title: "Shopping run deleted" });
      setSelectedRunId(""); setRunName("Shopping Run"); setRunStatus("DRAFT");
      loadRuns();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message ?? "Could not delete run.", variant: "destructive" });
    } finally { setDeletingRun(false); }
  }

  async function downloadPdf() {
    if (!selectedRunId) return toast({ title: "Save the run first to download PDF.", variant: "destructive" });
    setDownloadingPdf(true);
    try {
      const res = await fetch(`${runsApiBase}/${selectedRunId}/pdf`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not generate PDF.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `shopping-run-${selectedRunId}.pdf`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast({ title: "Shopping run PDF downloaded" });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message ?? "Could not download PDF.", variant: "destructive" });
    } finally { setDownloadingPdf(false); }
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading shopping planner...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{title ?? "Start Shopping"}</h1>
          <p className="text-sm text-muted-foreground">{description ?? "Plan restock runs, save progress, and export PDF."}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button>
          <Button variant="outline" onClick={loadData}><RotateCcw className="mr-2 h-4 w-4" />Refresh</Button>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {[
          ["Lines", summary.lines],
          ["Emergency", summary.emergencyLines],
          ["Need Units", summary.totalNeededUnits],
          ["Planned Units", summary.plannedUnits],
          ["Purchased", summary.purchasedLines],
          ["Est. Total", money(summary.estimatedTotal)],
        ].map(([label, value]) => (
          <Card key={String(label)}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value as any}</p></CardContent></Card>
        ))}
      </section>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Saved Shopping Runs</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_180px_220px_auto_auto_auto] lg:items-end">
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Run name</label><Input value={runName} onChange={(e) => setRunName(e.target.value)} /></div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Status</label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={runStatus} onChange={(e) => setRunStatus(e.target.value as RunStatus)}>
                <option value="DRAFT">Draft</option><option value="IN_PROGRESS">In Progress</option><option value="COMPLETED">Completed</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Saved runs</label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={selectedRunId} onChange={(e) => {
                const id = e.target.value; setSelectedRunId(id);
                const run = runs.find((r) => r.id === id);
                if (run) applyRun(run); else { setRunName("Shopping Run"); setRunStatus("DRAFT"); }
              }} disabled={loadingRuns}>
                <option value="">{loadingRuns ? "Loading..." : "New run (unsaved)"}</option>
                {runs.map((r) => <option key={r.id} value={r.id}>{r.name} [{r.status}]</option>)}
              </select>
            </div>
            <Button onClick={saveRun} disabled={savingRun}><Save className="mr-2 h-4 w-4" />{savingRun ? "Saving..." : (selectedRunId ? "Update" : "Save")}</Button>
            <Button variant="outline" onClick={downloadPdf} disabled={!selectedRunId || downloadingPdf}><Download className="mr-2 h-4 w-4" />{downloadingPdf ? "Preparing..." : "PDF"}</Button>
            <Button variant="destructive" onClick={deleteRun} disabled={!selectedRunId || deletingRun}><Trash2 className="mr-2 h-4 w-4" />{deletingRun ? "Deleting..." : "Delete"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><ShoppingCart className="h-4 w-4" />Shopping Controls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto_auto] md:items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Property scope</label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                <option value="all">All properties</option>
                {payload.properties.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.suburb})</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Space limit (units)</label>
              <div className="flex gap-2">
                <Input type="number" min="0" value={capacityUnits} onChange={(e) => setCapacityUnits(e.target.value)} placeholder="Optional" />
                <Button type="button" variant="outline" onClick={applyCapacityLimit}>Apply</Button>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={emergencyOnly}>Emergency only</Button>
            <Button type="button" variant="outline" onClick={smallQuantitiesMode}>Small quantities</Button>
            <Button type="button" onClick={resetPlan}>Reset</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Estimated Cost by Supplier</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {supplierTotals.length === 0 ? <p className="text-sm text-muted-foreground">No supplier totals.</p> : supplierTotals.map((s) => (
              <div key={`${s.category}-${s.supplier}`} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <div><p className="font-medium">{s.supplier}</p><p className="text-xs text-muted-foreground">{s.category}</p></div>
                <div className="text-right"><p className="font-semibold">{money(s.total)}</p><p className="text-xs text-muted-foreground">{s.units} units</p></div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Estimated Cost by Property</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {payload.propertySummaries.filter((p) => propertyId === "all" || p.propertyId === propertyId).filter((p) => groupedByProperty[p.propertyId]?.length).map((p) => {
              const rows = groupedByProperty[p.propertyId] ?? [];
              const total = rows.reduce((s, r) => s + r.estimatedLineCost, 0);
              return <div key={p.propertyId} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"><div><p className="font-medium">{p.propertyName}</p><p className="text-xs text-muted-foreground">{p.suburb}</p></div><div className="text-right"><p className="font-semibold">{money(total)}</p><p className="text-xs text-muted-foreground">{rows.length} lines</p></div></div>;
            })}
          </CardContent>
        </Card>
      </div>

      {filteredRows.length === 0 ? <Card><CardContent className="p-6 text-sm text-muted-foreground">No low-stock items found for this scope.</CardContent></Card> : (
        <Tabs value={view} onValueChange={(v) => setView(v as any)}>
          <TabsList>
            <TabsTrigger value="by-property">By Property</TabsTrigger>
            <TabsTrigger value="combined">Combined Items</TabsTrigger>
          </TabsList>
          <TabsContent value="by-property" className="space-y-4">
            {payload.propertySummaries.filter((p) => propertyId === "all" || p.propertyId === propertyId).filter((p) => groupedByProperty[p.propertyId]?.length).map((p) => {
              const rows = groupedByProperty[p.propertyId] ?? [];
              const est = rows.reduce((s, r) => s + r.estimatedLineCost, 0);
              return (
                <Card key={p.propertyId}>
                  <CardHeader className="pb-2"><CardTitle className="text-base flex flex-wrap items-center justify-between gap-2"><span>{p.propertyName} <span className="text-sm font-normal text-muted-foreground">({p.suburb})</span></span><span className="text-xs text-muted-foreground">Need {p.totalNeededUnits} | Est {money(est)}</span></CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1200px] text-sm">
                        <thead className="border-b bg-muted/30"><tr><th className="px-3 py-2 text-left">Buy</th><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">Supplier</th><th className="px-3 py-2 text-right">On hand</th><th className="px-3 py-2 text-right">Need</th><th className="px-3 py-2 text-right">Plan</th><th className="px-3 py-2 text-right">Unit Cost</th><th className="px-3 py-2 text-right">Est.</th><th className="px-3 py-2 text-left">Priority</th><th className="px-3 py-2 text-left">Done</th><th className="px-3 py-2 text-left">Notes</th></tr></thead>
                        <tbody>
                          {rows.map((e) => (
                            <tr key={e.key} className="border-b align-top last:border-0">
                              <td className="px-3 py-2"><input type="checkbox" checked={e.draft.include} onChange={(x) => updateDraft(e.key, { include: x.target.checked })} /></td>
                              <td className="px-3 py-2"><div className="font-medium">{e.row.item.name}</div><div className="text-xs text-muted-foreground">{e.row.item.category}</div></td>
                              <td className="px-3 py-2 text-muted-foreground">{e.row.item.supplier ?? "-"}</td>
                              <td className="px-3 py-2 text-right">{e.row.onHand} {e.row.item.unit}</td>
                              <td className="px-3 py-2 text-right text-destructive">{e.row.needed}</td>
                              <td className="px-3 py-2 text-right"><Input className="ml-auto w-20 text-right" type="number" min="0" max={Math.max(0, e.row.needed)} value={e.draft.plannedQty} onChange={(x) => updateDraft(e.key, { plannedQty: Math.max(0, Math.min(e.row.needed, Number(x.target.value || 0))), include: true })} /></td>
                              <td className="px-3 py-2 text-right">{e.row.estimatedUnitCost != null ? money(Number(e.row.estimatedUnitCost)) : "-"}</td>
                              <td className="px-3 py-2 text-right">{e.row.estimatedUnitCost != null ? money(e.estimatedLineCost) : "-"}</td>
                              <td className="px-3 py-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${e.priority.label === "Emergency" ? "border-destructive/30 bg-destructive/5 text-destructive" : e.priority.label === "High" ? "border-orange-300 bg-orange-50 text-orange-700" : "border-border text-muted-foreground"}`}>{e.priority.label}</span></td>
                              <td className="px-3 py-2"><input type="checkbox" checked={e.draft.purchased} onChange={(x) => updateDraft(e.key, { purchased: x.target.checked })} /></td>
                              <td className="px-3 py-2"><Input className="min-w-[160px]" value={e.draft.note} onChange={(x) => updateDraft(e.key, { note: x.target.value })} placeholder="Optional note" /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>
          <TabsContent value="combined" className="space-y-4">
            {combinedItems.map((g) => (
              <Card key={`${g.itemId}-${g.supplier ?? ""}`}>
                <CardHeader className="pb-2"><CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base"><span>{g.itemName}</span><span className="text-xs text-muted-foreground">{g.category} | {g.supplier ?? "Unknown"} | need {g.totalNeeded} | planned {g.totalPlanned} {g.unit} | est {money(g.totalCost)}</span></CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {g.properties.map((p) => (
                    <div key={`${p.propertyId}-${g.itemId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                      <div><p className="font-medium">{p.propertyName}</p><p className="text-xs text-muted-foreground">{p.suburb}</p></div>
                      <div className="flex flex-wrap items-center gap-3 text-xs"><span>Need {p.needed}</span><span>Planned {p.planned}</span><span className="font-medium">{money(p.cost)}</span><span className={`inline-flex rounded-full border px-2 py-0.5 ${p.priority === "Emergency" ? "border-destructive/30 bg-destructive/5 text-destructive" : p.priority === "High" ? "border-orange-300 bg-orange-50 text-orange-700" : "border-border text-muted-foreground"}`}>{p.priority}</span></div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
