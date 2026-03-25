"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  estimatedLineCost?: number | null;
};

type PropertyOption = { id: string; name: string; suburb: string };

type PropertySummary = {
  propertyId: string;
  propertyName: string;
  suburb: string;
  lineCount: number;
  totalNeededUnits: number;
  emergencyCount: number;
  estimatedCost?: number;
};

type Payload = {
  rows: ShoppingRow[];
  properties: PropertyOption[];
  propertySummaries: PropertySummary[];
};

type RunStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED";

type SavedRun = {
  id: string;
  name: string;
  status: RunStatus;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  totals?: {
    includedLineCount?: number;
    estimatedTotalCost?: number;
    actualTotalCost?: number;
  };
};

type DraftRow = {
  include: boolean;
  plannedQty: number;
};

type Props = {
  mode: "client" | "cleaner";
  apiPath: string;
  runsApiBase: string;
  workspaceBasePath: string;
  initialPropertyId?: string;
  title: string;
  description: string;
};

const rowKey = (row: ShoppingRow) => `${row.propertyId}::${row.item.id}`;

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function formatRunStatus(status: RunStatus) {
  if (status === "IN_PROGRESS") return "Active";
  if (status === "COMPLETED") return "Submitted";
  return "Draft";
}

function priorityForRow(row: ShoppingRow) {
  if (row.onHand <= 0) return "Emergency" as const;
  if (row.onHand <= row.reorderThreshold) return "High" as const;
  return "Normal" as const;
}

function buildDefaultRunName(mode: "client" | "cleaner") {
  const today = new Date().toLocaleDateString("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  return `${mode === "client" ? "Client" : "Cleaner"} shopping ${today}`;
}

export function ShoppingRunLauncher({
  mode,
  apiPath,
  runsApiBase,
  workspaceBasePath,
  initialPropertyId,
  title,
  description,
}: Props) {
  const router = useRouter();
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [creating, setCreating] = useState<RunStatus | "">("");
  const [runName, setRunName] = useState(() => buildDefaultRunName(mode));
  const [propertyId, setPropertyId] = useState(initialPropertyId ?? "all");
  const [payload, setPayload] = useState<Payload>({ rows: [], properties: [], propertySummaries: [] });
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [runs, setRuns] = useState<SavedRun[]>([]);

  async function loadPlan() {
    setLoadingPlan(true);
    try {
      const qs = propertyId !== "all" ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
      const res = await fetch(`${apiPath}${qs}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load the shopping list.");
      const rows = Array.isArray(body.rows) ? (body.rows as ShoppingRow[]) : [];
      const properties = Array.isArray(body.properties) ? (body.properties as PropertyOption[]) : [];
      const propertySummaries = Array.isArray(body.propertySummaries)
        ? (body.propertySummaries as PropertySummary[])
        : [];
      setPayload({ rows, properties, propertySummaries });
      setDrafts((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          const key = rowKey(row);
          next[key] ??= {
            include: row.needed > 0,
            plannedQty: Math.max(0, row.needed),
          };
        }
        return next;
      });
    } catch (error: any) {
      toast({
        title: "Shopping list failed",
        description: error?.message ?? "Could not load the shopping list.",
        variant: "destructive",
      });
    } finally {
      setLoadingPlan(false);
    }
  }

  async function loadRuns() {
    setLoadingRuns(true);
    try {
      const res = await fetch(runsApiBase, { cache: "no-store" });
      const body = await res.json().catch(() => []);
      if (!res.ok) throw new Error((body as any)?.error ?? "Could not load runs.");
      setRuns(Array.isArray(body) ? (body as SavedRun[]) : []);
    } catch (error: any) {
      toast({
        title: "Shopping runs failed",
        description: error?.message ?? "Could not load shopping runs.",
        variant: "destructive",
      });
    } finally {
      setLoadingRuns(false);
    }
  }

  useEffect(() => {
    void loadPlan();
  }, [apiPath, propertyId]);

  useEffect(() => {
    void loadRuns();
  }, [runsApiBase]);

  const filteredRows = useMemo(() => {
    const rows = propertyId === "all"
      ? payload.rows
      : payload.rows.filter((row) => row.propertyId === propertyId);
    return rows
      .map((row) => {
        const key = rowKey(row);
        return {
          row,
          key,
          draft: drafts[key] ?? { include: row.needed > 0, plannedQty: Math.max(0, row.needed) },
          priority: priorityForRow(row),
        };
      })
      .sort((a, b) => {
        const priorityScore = { Emergency: 3, High: 2, Normal: 1 } as const;
        return (
          priorityScore[b.priority] - priorityScore[a.priority] ||
          b.row.needed - a.row.needed ||
          a.row.propertyName.localeCompare(b.row.propertyName) ||
          a.row.item.name.localeCompare(b.row.item.name)
        );
      });
  }, [drafts, payload.rows, propertyId]);

  const groupedRows = useMemo(() => {
    return filteredRows.reduce<
      Array<{
        propertyId: string;
        propertyName: string;
        suburb: string;
        rows: typeof filteredRows;
      }>
    >((acc, entry) => {
      const existing = acc.find((item) => item.propertyId === entry.row.propertyId);
      if (existing) {
        existing.rows.push(entry);
        return acc;
      }
      acc.push({
        propertyId: entry.row.propertyId,
        propertyName: entry.row.propertyName,
        suburb: entry.row.suburb,
        rows: [entry],
      });
      return acc;
    }, []);
  }, [filteredRows]);

  const summary = useMemo(() => {
    const selected = filteredRows.filter((entry) => entry.draft.include);
    return {
      lineCount: filteredRows.length,
      selectedLines: selected.length,
      plannedUnits: selected.reduce((sum, entry) => sum + Math.max(0, Number(entry.draft.plannedQty || 0)), 0),
      emergencyLines: filteredRows.filter((entry) => entry.priority === "Emergency").length,
      estimatedTotal: selected.reduce(
        (sum, entry) =>
          sum +
          (entry.row.estimatedUnitCost != null
            ? Number(entry.draft.plannedQty || 0) * Number(entry.row.estimatedUnitCost)
            : 0),
        0
      ),
    };
  }, [filteredRows]);

  const activeRuns = useMemo(
    () => runs.filter((run) => run.status !== "COMPLETED"),
    [runs]
  );

  const submittedRuns = useMemo(
    () => runs.filter((run) => run.status === "COMPLETED").slice(0, 8),
    [runs]
  );

  function updateDraft(key: string, patch: Partial<DraftRow>) {
    setDrafts((prev) => {
      const base = prev[key] ?? { include: true, plannedQty: 0 };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  }

  function selectEmergencyOnly() {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const entry of filteredRows) {
        const include = entry.priority === "Emergency";
        next[entry.key] = {
          include,
          plannedQty: include ? Math.max(1, Math.min(entry.row.needed, entry.row.reorderThreshold || entry.row.needed)) : 0,
        };
      }
      return next;
    });
  }

  function resetSelection() {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const entry of filteredRows) {
        next[entry.key] = {
          include: entry.row.needed > 0,
          plannedQty: Math.max(0, entry.row.needed),
        };
      }
      return next;
    });
  }

  function buildRows() {
    return filteredRows.map((entry) => {
      const plannedQty = Math.max(0, Number(entry.draft.plannedQty || 0));
      return {
        propertyId: entry.row.propertyId,
        propertyName: entry.row.propertyName,
        suburb: entry.row.suburb,
        itemId: entry.row.item.id,
        itemName: entry.row.item.name,
        category: entry.row.item.category,
        supplier: entry.row.item.supplier ?? null,
        unit: entry.row.item.unit,
        onHand: entry.row.onHand,
        parLevel: entry.row.parLevel,
        reorderThreshold: entry.row.reorderThreshold,
        needed: entry.row.needed,
        plannedQty,
        include: Boolean(entry.draft.include && plannedQty > 0),
        purchased: false,
        actualPurchasedQty: 0,
        actualUnitCost: entry.row.estimatedUnitCost ?? null,
        actualLineCost: null,
        note: undefined,
        priority: entry.priority === "Normal" ? "Medium" : entry.priority,
        estimatedUnitCost: entry.row.estimatedUnitCost ?? null,
        estimatedLineCost:
          entry.row.estimatedUnitCost != null ? plannedQty * Number(entry.row.estimatedUnitCost) : null,
      };
    });
  }

  async function createRun(status: RunStatus) {
    const name = runName.trim();
    if (!name) {
      toast({ title: "Run name required", variant: "destructive" });
      return;
    }

    const rows = buildRows();
    const included = rows.filter((row) => row.include);
    if (included.length === 0) {
      toast({
        title: "Nothing selected",
        description: "Select at least one item before starting a shopping run.",
        variant: "destructive",
      });
      return;
    }

    setCreating(status);
    try {
      const res = await fetch(runsApiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          status,
          planningScope: propertyId,
          startedAt: status === "IN_PROGRESS" ? new Date().toISOString() : undefined,
          rows,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create the shopping run.");
      toast({
        title: status === "IN_PROGRESS" ? "Shopping run started" : "Draft saved",
      });
      router.push(`${workspaceBasePath}/${body.id}`);
      router.refresh();
    } catch (error: any) {
      toast({
        title: "Shopping run failed",
        description: error?.message ?? "Could not start the shopping run.",
        variant: "destructive",
      });
    } finally {
      setCreating("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start a shopping run</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1.2fr_240px]">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Run name</label>
                <Input
                  value={runName}
                  onChange={(event) => setRunName(event.target.value)}
                  placeholder="Shopping run name"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Property scope</label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={propertyId}
                  onChange={(event) => setPropertyId(event.target.value)}
                >
                  <option value="all">All visible properties</option>
                  {payload.properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name} ({property.suburb})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void createRun("DRAFT")}
                disabled={creating !== ""}
              >
                {creating === "DRAFT" ? "Saving..." : "Save draft"}
              </Button>
              <Button onClick={() => void createRun("IN_PROGRESS")} disabled={creating !== ""}>
                <ShoppingCart className="mr-2 h-4 w-4" />
                {creating === "IN_PROGRESS" ? "Starting..." : "Start shopping"}
              </Button>
            </div>

            <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
              Step 1: choose what needs to be bought.
              <br />
              Step 2: start the run.
              <br />
              Step 3: track purchases, receipts, payment method, and shopping time inside the run workspace.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Selected lines</p>
              <p className="text-2xl font-semibold">{summary.selectedLines}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Planned units</p>
              <p className="text-2xl font-semibold">{summary.plannedUnits}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Emergency lines</p>
              <p className="text-2xl font-semibold">{summary.emergencyLines}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Estimated total</p>
              <p className="text-2xl font-semibold">{money(summary.estimatedTotal)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Continue an existing run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingRuns ? (
            <p className="text-sm text-muted-foreground">Loading shopping runs...</p>
          ) : activeRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No open shopping runs. Start a new one from the list below.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {activeRuns.map((run) => (
                <div key={run.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{run.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRunStatus(run.status)} · updated{" "}
                        {new Date(run.updatedAt).toLocaleString("en-AU")}
                      </p>
                    </div>
                    <Button asChild size="sm">
                      <Link href={`${workspaceBasePath}/${run.id}`}>
                        Continue
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Lines {run.totals?.includedLineCount ?? 0}</span>
                    <span>Estimated {money(run.totals?.estimatedTotalCost ?? 0)}</span>
                    <span>Actual {money(run.totals?.actualTotalCost ?? 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {submittedRuns.length > 0 ? (
            <div className="border-t pt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recently submitted
              </p>
              <div className="space-y-2">
                {submittedRuns.map((run) => (
                  <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                    <div>
                      <p className="font-medium">{run.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Submitted {new Date(run.updatedAt).toLocaleString("en-AU")}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`${workspaceBasePath}/${run.id}`}>Open</Link>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Items to buy</CardTitle>
              <p className="text-sm text-muted-foreground">
                Select the items to include before starting the run.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={selectEmergencyOnly}>
                Emergency only
              </Button>
              <Button type="button" variant="outline" onClick={resetSelection}>
                Reset
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingPlan ? (
            <p className="text-sm text-muted-foreground">Loading items...</p>
          ) : groupedRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No low-stock items were found for this scope.
            </p>
          ) : (
            groupedRows.map((group) => (
              <div key={group.propertyId} className="rounded-lg border">
                <div className="border-b px-4 py-3">
                  <p className="font-medium">
                    {group.propertyName}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      ({group.suburb})
                    </span>
                  </p>
                </div>
                <div className="divide-y">
                  {group.rows.map((entry) => (
                    <div
                      key={entry.key}
                      className="grid gap-3 px-4 py-3 md:grid-cols-[auto_1fr_90px_90px_110px] md:items-center"
                    >
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={entry.draft.include}
                          onChange={(event) =>
                            updateDraft(entry.key, { include: event.target.checked })
                          }
                        />
                        Buy
                      </label>
                      <div>
                        <p className="font-medium">{entry.row.item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.row.item.category}
                          {entry.row.item.supplier ? ` · ${entry.row.item.supplier}` : ""}
                          {` · on hand ${entry.row.onHand} · need ${entry.row.needed}`}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Qty</p>
                        <Input
                          type="number"
                          min="0"
                          max={Math.max(0, entry.row.needed)}
                          value={entry.draft.plannedQty}
                          onChange={(event) =>
                            updateDraft(entry.key, {
                              plannedQty: Math.max(
                                0,
                                Math.min(entry.row.needed, Number(event.target.value || 0))
                              ),
                              include: true,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Est.</p>
                        <p className="text-sm font-medium">
                          {entry.row.estimatedUnitCost != null
                            ? money(Number(entry.draft.plannedQty || 0) * Number(entry.row.estimatedUnitCost))
                            : "-"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Priority</p>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${
                            entry.priority === "Emergency"
                              ? "border-destructive/30 bg-destructive/5 text-destructive"
                              : entry.priority === "High"
                                ? "border-orange-300 bg-orange-50 text-orange-700"
                                : "border-border text-muted-foreground"
                          }`}
                        >
                          {entry.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
