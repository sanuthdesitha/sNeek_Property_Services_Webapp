"use client";

/**
 * Estate cleaner shopping launcher — plan low-stock items into a shopping run.
 * Same endpoints + payloads as the live launcher (components/inventory/
 * shopping-run-launcher.tsx), fixed to the cleaner API surface:
 *   GET  /api/cleaner/inventory/shopping-plan[?propertyId]
 *   GET  /api/cleaner/inventory/shopping-runs                → SavedRun[]
 *   POST /api/cleaner/inventory/shopping-runs  { name, status, planningScope,
 *          startedAt?, rows[] }                              → { id }
 * On create it navigates to /v2/cleaner/shopping/{id}.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ShoppingCart } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { ECheckbox, EField, EInput, ESelect } from "@/components/v2/cleaner/fields";
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
type Payload = { rows: ShoppingRow[]; properties: PropertyOption[] };
type RunStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED";
type SavedRun = {
  id: string;
  name: string;
  status: RunStatus;
  updatedAt: string;
  totals?: { includedLineCount?: number; estimatedTotalCost?: number; actualTotalCost?: number };
};
type DraftRow = { include: boolean; plannedQty: number };

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
function buildDefaultRunName() {
  const today = new Date().toLocaleDateString("en-AU", { weekday: "short", day: "2-digit", month: "short" });
  return `Cleaner shopping ${today}`;
}

const PRIORITY_TONE = { Emergency: "danger", High: "warning", Normal: "neutral" } as const;

export function ShoppingLauncher({
  apiPath = "/api/cleaner/inventory/shopping-plan",
  runsApiBase = "/api/cleaner/inventory/shopping-runs",
  workspaceBasePath = "/v2/cleaner/shopping",
  initialPropertyId,
}: {
  apiPath?: string;
  runsApiBase?: string;
  workspaceBasePath?: string;
  initialPropertyId?: string;
}) {
  const router = useRouter();
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [creating, setCreating] = useState<RunStatus | "">("");
  const [runName, setRunName] = useState(buildDefaultRunName);
  const [propertyId, setPropertyId] = useState(initialPropertyId ?? "all");
  const [payload, setPayload] = useState<Payload>({ rows: [], properties: [] });
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
      setPayload({ rows, properties });
      setDrafts((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          const key = rowKey(row);
          next[key] ??= { include: row.needed > 0, plannedQty: Math.max(0, row.needed) };
        }
        return next;
      });
    } catch (error: any) {
      toast({ title: "Shopping list failed", description: error?.message, variant: "destructive" });
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
      toast({ title: "Shopping runs failed", description: error?.message, variant: "destructive" });
    } finally {
      setLoadingRuns(false);
    }
  }

  useEffect(() => {
    void loadPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiPath, propertyId]);
  useEffect(() => {
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runsApiBase]);

  const filteredRows = useMemo(() => {
    const rows = propertyId === "all" ? payload.rows : payload.rows.filter((r) => r.propertyId === propertyId);
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
        const score = { Emergency: 3, High: 2, Normal: 1 } as const;
        return (
          score[b.priority] - score[a.priority] ||
          b.row.needed - a.row.needed ||
          a.row.propertyName.localeCompare(b.row.propertyName) ||
          a.row.item.name.localeCompare(b.row.item.name)
        );
      });
  }, [drafts, payload.rows, propertyId]);

  const groupedRows = useMemo(() => {
    return filteredRows.reduce<
      Array<{ propertyId: string; propertyName: string; suburb: string; rows: typeof filteredRows }>
    >((acc, entry) => {
      const existing = acc.find((i) => i.propertyId === entry.row.propertyId);
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
    const selected = filteredRows.filter((e) => e.draft.include);
    return {
      selectedLines: selected.length,
      plannedUnits: selected.reduce((s, e) => s + Math.max(0, Number(e.draft.plannedQty || 0)), 0),
      emergencyLines: filteredRows.filter((e) => e.priority === "Emergency").length,
      estimatedTotal: selected.reduce(
        (s, e) =>
          s + (e.row.estimatedUnitCost != null ? Number(e.draft.plannedQty || 0) * Number(e.row.estimatedUnitCost) : 0),
        0
      ),
    };
  }, [filteredRows]);

  const activeRuns = useMemo(() => runs.filter((r) => r.status !== "COMPLETED"), [runs]);
  const submittedRuns = useMemo(() => runs.filter((r) => r.status === "COMPLETED").slice(0, 8), [runs]);

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
          plannedQty: include
            ? Math.max(1, Math.min(entry.row.needed, entry.row.reorderThreshold || entry.row.needed))
            : 0,
        };
      }
      return next;
    });
  }
  function resetSelection() {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const entry of filteredRows) {
        next[entry.key] = { include: entry.row.needed > 0, plannedQty: Math.max(0, entry.row.needed) };
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
    const included = rows.filter((r) => r.include);
    if (included.length === 0) {
      toast({ title: "Nothing selected", description: "Select at least one item.", variant: "destructive" });
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
      toast({ title: status === "IN_PROGRESS" ? "Shopping run started" : "Draft saved" });
      router.push(`${workspaceBasePath}/${body.id}`);
      router.refresh();
    } catch (error: any) {
      toast({ title: "Shopping run failed", description: error?.message, variant: "destructive" });
    } finally {
      setCreating("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <ECard>
          <ECardHeader>
            <ECardTitle>Start a shopping run</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1.2fr_240px]">
              <EField label="Run name">
                <EInput value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="Shopping run name" />
              </EField>
              <EField label="Property scope">
                <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  <option value="all">All visible properties</option>
                  {payload.properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name} ({property.suburb})
                    </option>
                  ))}
                </ESelect>
              </EField>
            </div>
            <div className="flex flex-wrap gap-2">
              <EButton variant="outline" onClick={() => void createRun("DRAFT")} disabled={creating !== ""}>
                {creating === "DRAFT" ? "Saving…" : "Save draft"}
              </EButton>
              <EButton variant="gold" onClick={() => void createRun("IN_PROGRESS")} disabled={creating !== ""}>
                <ShoppingCart className="h-4 w-4" />
                {creating === "IN_PROGRESS" ? "Starting…" : "Start shopping"}
              </EButton>
            </div>
          </ECardBody>
        </ECard>

        <ECard>
          <ECardHeader>
            <ECardTitle>Run summary</ECardTitle>
          </ECardHeader>
          <ECardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {[
              { label: "Selected lines", value: summary.selectedLines },
              { label: "Planned units", value: summary.plannedUnits },
              { label: "Emergency lines", value: summary.emergencyLines },
              { label: "Estimated total", value: money(summary.estimatedTotal) },
            ].map((s) => (
              <div key={s.label} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="e-eyebrow text-[0.625rem]">{s.label}</p>
                <p className="e-numeral mt-1 text-[1.5rem] leading-none">{s.value}</p>
              </div>
            ))}
          </ECardBody>
        </ECard>
      </div>

      {/* Continue an existing run */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Continue an existing run</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-3">
          {loadingRuns ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading shopping runs…</p>
          ) : activeRuns.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No open shopping runs. Start a new one above.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {activeRuns.map((run) => (
                <div key={run.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[0.9375rem] font-[550]">{run.name}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {formatRunStatus(run.status)} · updated {new Date(run.updatedAt).toLocaleString("en-AU")}
                      </p>
                    </div>
                    <EButton asChild size="sm">
                      <Link href={`${workspaceBasePath}/${run.id}`}>
                        Continue <ArrowRight className="h-4 w-4" />
                      </Link>
                    </EButton>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <span>Lines {run.totals?.includedLineCount ?? 0}</span>
                    <span>Estimated {money(run.totals?.estimatedTotalCost ?? 0)}</span>
                    <span>Actual {money(run.totals?.actualTotalCost ?? 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {submittedRuns.length > 0 ? (
            <div className="border-t border-[hsl(var(--e-border))] pt-3">
              <p className="mb-2 e-eyebrow">Recently submitted</p>
              <div className="space-y-2">
                {submittedRuns.map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"
                  >
                    <div>
                      <p className="text-[0.875rem] font-[550]">{run.name}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        Submitted {new Date(run.updatedAt).toLocaleString("en-AU")}
                      </p>
                    </div>
                    <EButton asChild variant="outline" size="sm">
                      <Link href={`${workspaceBasePath}/${run.id}`}>Open</Link>
                    </EButton>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </ECardBody>
      </ECard>

      {/* Items to buy */}
      <ECard>
        <ECardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <ECardTitle>Items to buy</ECardTitle>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Select the items to include before starting the run.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <EButton type="button" variant="outline" size="sm" onClick={selectEmergencyOnly}>
                Emergency only
              </EButton>
              <EButton type="button" variant="outline" size="sm" onClick={resetSelection}>
                Reset
              </EButton>
            </div>
          </div>
        </ECardHeader>
        <ECardBody className="space-y-4">
          {loadingPlan ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading items…</p>
          ) : groupedRows.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No low-stock items were found for this scope.
            </p>
          ) : (
            groupedRows.map((group) => (
              <div key={group.propertyId} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]">
                <div className="border-b border-[hsl(var(--e-border))] px-4 py-3">
                  <p className="text-[0.9375rem] font-[550]">
                    {group.propertyName}{" "}
                    <span className="text-[0.8125rem] font-normal text-[hsl(var(--e-muted-foreground))]">
                      ({group.suburb})
                    </span>
                  </p>
                </div>
                <div className="divide-y divide-[hsl(var(--e-border))]">
                  {group.rows.map((entry) => (
                    <div
                      key={entry.key}
                      className="grid gap-3 px-4 py-3 md:grid-cols-[auto_1fr_90px_90px_110px] md:items-center"
                    >
                      <label className="inline-flex items-center gap-2 text-[0.8125rem]">
                        <ECheckbox
                          checked={entry.draft.include}
                          onChange={(e) => updateDraft(entry.key, { include: e.target.checked })}
                        />
                        Buy
                      </label>
                      <div>
                        <p className="text-[0.875rem] font-[550]">{entry.row.item.name}</p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {entry.row.item.category}
                          {entry.row.item.supplier ? ` · ${entry.row.item.supplier}` : ""}
                          {` · on hand ${entry.row.onHand} · need ${entry.row.needed}`}
                        </p>
                      </div>
                      <EField label="Qty">
                        <EInput
                          type="number"
                          min="0"
                          max={Math.max(0, entry.row.needed)}
                          value={entry.draft.plannedQty}
                          onChange={(e) =>
                            updateDraft(entry.key, {
                              plannedQty: Math.max(0, Math.min(entry.row.needed, Number(e.target.value || 0))),
                              include: true,
                            })
                          }
                        />
                      </EField>
                      <div className="space-y-1">
                        <p className="e-eyebrow text-[0.625rem]">Est.</p>
                        <p className="text-[0.875rem] font-[550]">
                          {entry.row.estimatedUnitCost != null
                            ? money(Number(entry.draft.plannedQty || 0) * Number(entry.row.estimatedUnitCost))
                            : "-"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="e-eyebrow text-[0.625rem]">Priority</p>
                        <EBadge tone={PRIORITY_TONE[entry.priority]} soft>
                          {entry.priority}
                        </EBadge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
