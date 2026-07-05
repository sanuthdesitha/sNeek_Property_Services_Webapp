"use client";

/**
 * Estate shopping run launcher — same endpoints as the legacy ShoppingRunLauncher:
 *   GET  /api/client/inventory/shopping-plan[?propertyId]  → { rows, properties, propertySummaries }
 *   GET  /api/client/inventory/shopping-runs               → SavedRun[]
 *   POST /api/client/inventory/shopping-runs   { name, status, planningScope, startedAt?, rows } → { id }
 * Styled purely with `--e-*` tokens. No v1 UI imports.
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
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { EInput, ESelect, EField } from "@/components/v2/admin/estate-kit";
import { EInlineNotice, ECheckTile } from "@/components/v2/client/fields";
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
type Payload = { rows: ShoppingRow[]; properties: PropertyOption[]; propertySummaries: unknown[] };
type RunStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED";
type SavedRun = {
  id: string;
  name: string;
  status: RunStatus;
  updatedAt: string;
  totals?: { includedLineCount?: number; estimatedTotalCost?: number; actualTotalCost?: number };
};
type DraftRow = { include: boolean; plannedQty: number };

type Props = {
  apiPath: string;
  runsApiBase: string;
  workspaceBasePath: string;
  initialPropertyId?: string;
};

const rowKey = (row: ShoppingRow) => `${row.propertyId}::${row.item.id}`;
const money = (v: number | null | undefined) => `$${Number(v ?? 0).toFixed(2)}`;

function priorityForRow(row: ShoppingRow): "Emergency" | "High" | "Normal" {
  if (row.onHand <= 0) return "Emergency";
  if (row.onHand <= row.reorderThreshold) return "High";
  return "Normal";
}
function priorityTone(p: "Emergency" | "High" | "Normal"): "danger" | "warning" | "neutral" {
  return p === "Emergency" ? "danger" : p === "High" ? "warning" : "neutral";
}
function runStatusMeta(status: RunStatus): { label: string; tone: "gold" | "success" | "neutral" } {
  if (status === "IN_PROGRESS") return { label: "Active", tone: "gold" };
  if (status === "COMPLETED") return { label: "Submitted", tone: "success" };
  return { label: "Draft", tone: "neutral" };
}
function buildDefaultRunName() {
  const today = new Date().toLocaleDateString("en-AU", { weekday: "short", day: "2-digit", month: "short" });
  return `Client shopping ${today}`;
}

export function ShoppingLauncher({ apiPath, runsApiBase, workspaceBasePath, initialPropertyId }: Props) {
  const router = useRouter();
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const [creating, setCreating] = useState<RunStatus | "">("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [runName, setRunName] = useState(buildDefaultRunName);
  const [propertyId, setPropertyId] = useState(initialPropertyId ?? "all");
  const [payload, setPayload] = useState<Payload>({ rows: [], properties: [], propertySummaries: [] });
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [runs, setRuns] = useState<SavedRun[]>([]);

  async function loadPlan() {
    setLoadingPlan(true);
    setPlanError(null);
    try {
      const qs = propertyId !== "all" ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
      const res = await fetch(`${apiPath}${qs}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load the shopping list.");
      const rows = Array.isArray(body.rows) ? (body.rows as ShoppingRow[]) : [];
      const properties = Array.isArray(body.properties) ? (body.properties as PropertyOption[]) : [];
      setPayload({ rows, properties, propertySummaries: [] });
      setDrafts((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          next[rowKey(row)] ??= { include: row.needed > 0, plannedQty: Math.max(0, row.needed) };
        }
        return next;
      });
    } catch (error: any) {
      setPlanError(error?.message ?? "Could not load the shopping list.");
    } finally {
      setLoadingPlan(false);
    }
  }

  async function loadRuns() {
    setLoadingRuns(true);
    try {
      const res = await fetch(runsApiBase, { cache: "no-store" });
      const body = await res.json().catch(() => []);
      if (res.ok) setRuns(Array.isArray(body) ? (body as SavedRun[]) : []);
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
    return filteredRows.reduce<Array<{ propertyId: string; propertyName: string; suburb: string; rows: typeof filteredRows }>>(
      (acc, entry) => {
        const existing = acc.find((i) => i.propertyId === entry.row.propertyId);
        if (existing) existing.rows.push(entry);
        else
          acc.push({
            propertyId: entry.row.propertyId,
            propertyName: entry.row.propertyName,
            suburb: entry.row.suburb,
            rows: [entry],
          });
        return acc;
      },
      []
    );
  }, [filteredRows]);

  const summary = useMemo(() => {
    const selected = filteredRows.filter((e) => e.draft.include);
    return {
      selectedLines: selected.length,
      plannedUnits: selected.reduce((s, e) => s + Math.max(0, Number(e.draft.plannedQty || 0)), 0),
      emergencyLines: filteredRows.filter((e) => e.priority === "Emergency").length,
      estimatedTotal: selected.reduce(
        (s, e) => s + (e.row.estimatedUnitCost != null ? Number(e.draft.plannedQty || 0) * Number(e.row.estimatedUnitCost) : 0),
        0
      ),
    };
  }, [filteredRows]);

  const activeRuns = useMemo(() => runs.filter((r) => r.status !== "COMPLETED"), [runs]);
  const submittedRuns = useMemo(() => runs.filter((r) => r.status === "COMPLETED").slice(0, 8), [runs]);

  function updateDraft(key: string, patch: Partial<DraftRow>) {
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { include: true, plannedQty: 0 }), ...patch } }));
  }
  function selectEmergencyOnly() {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const e of filteredRows) {
        const include = e.priority === "Emergency";
        next[e.key] = {
          include,
          plannedQty: include ? Math.max(1, Math.min(e.row.needed, e.row.reorderThreshold || e.row.needed)) : 0,
        };
      }
      return next;
    });
  }
  function resetSelection() {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const e of filteredRows) next[e.key] = { include: e.row.needed > 0, plannedQty: Math.max(0, e.row.needed) };
      return next;
    });
  }

  function buildRows() {
    return filteredRows.map((e) => {
      const plannedQty = Math.max(0, Number(e.draft.plannedQty || 0));
      return {
        propertyId: e.row.propertyId,
        propertyName: e.row.propertyName,
        suburb: e.row.suburb,
        itemId: e.row.item.id,
        itemName: e.row.item.name,
        category: e.row.item.category,
        supplier: e.row.item.supplier ?? null,
        unit: e.row.item.unit,
        onHand: e.row.onHand,
        parLevel: e.row.parLevel,
        reorderThreshold: e.row.reorderThreshold,
        needed: e.row.needed,
        plannedQty,
        include: Boolean(e.draft.include && plannedQty > 0),
        purchased: false,
        actualPurchasedQty: 0,
        actualUnitCost: e.row.estimatedUnitCost ?? null,
        actualLineCost: null,
        note: undefined,
        priority: e.priority === "Normal" ? "Medium" : e.priority,
        estimatedUnitCost: e.row.estimatedUnitCost ?? null,
        estimatedLineCost: e.row.estimatedUnitCost != null ? plannedQty * Number(e.row.estimatedUnitCost) : null,
      };
    });
  }

  async function createRun(status: RunStatus) {
    const name = runName.trim();
    setCreateError(null);
    if (!name) {
      setCreateError("Enter a run name first.");
      return;
    }
    const rows = buildRows();
    if (rows.filter((r) => r.include).length === 0) {
      setCreateError("Select at least one item before starting a shopping run.");
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
      setCreateError(error?.message ?? "Could not start the shopping run.");
    } finally {
      setCreating("");
    }
  }

  return (
    <div className="space-y-6">
      {/* Start a run + summary */}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <ECard>
          <ECardBody className="space-y-4 p-6">
            <EEyebrow>Step 1 · Plan the run</EEyebrow>
            <div className="grid gap-3 md:grid-cols-[1.2fr_240px]">
              <EField label="Run name">
                <EInput value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="Shopping run name" />
              </EField>
              <EField label="Property scope">
                <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  <option value="all">All visible properties</option>
                  {payload.properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.suburb})
                    </option>
                  ))}
                </ESelect>
              </EField>
            </div>
            <div className="flex flex-wrap gap-2">
              <EButton variant="outline" onClick={() => void createRun("DRAFT")} disabled={creating !== ""}>
                {creating === "DRAFT" ? "Saving…" : "Save draft"}
              </EButton>
              <EButton onClick={() => void createRun("IN_PROGRESS")} disabled={creating !== ""}>
                <ShoppingCart className="h-4 w-4" />
                {creating === "IN_PROGRESS" ? "Starting…" : "Start shopping"}
              </EButton>
            </div>
            {createError ? <EInlineNotice tone="danger">{createError}</EInlineNotice> : null}
            <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Choose what needs buying, start the run, then track receipts and payment inside the run workspace.
            </div>
          </ECardBody>
        </ECard>

        <ECard>
          <ECardBody className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-1">
            <EEyebrow className="sm:col-span-2 lg:col-span-1">Run summary</EEyebrow>
            {[
              ["Selected lines", String(summary.selectedLines)],
              ["Planned units", String(summary.plannedUnits)],
              ["Emergency lines", String(summary.emergencyLines)],
              ["Estimated total", money(summary.estimatedTotal)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">{label}</p>
                <p className="e-numeral e-tnum mt-1 text-[1.5rem] leading-none">{value}</p>
              </div>
            ))}
          </ECardBody>
        </ECard>
      </div>

      {/* Continue existing runs */}
      <ECard>
        <ECardBody className="space-y-3 p-6">
          <EEyebrow>Step 2 · Continue an existing run</EEyebrow>
          {loadingRuns ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading shopping runs…</p>
          ) : activeRuns.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No open shopping runs. Start a new one above.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {activeRuns.map((run) => {
                const meta = runStatusMeta(run.status);
                return (
                  <div key={run.id} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-[550]">{run.name}</p>
                        <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          updated {new Date(run.updatedAt).toLocaleString("en-AU")}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <EBadge tone={meta.tone} soft>
                          {meta.label}
                        </EBadge>
                        <EButton asChild size="sm">
                          <Link href={`${workspaceBasePath}/${run.id}`}>
                            Continue
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </EButton>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      <span>Lines {run.totals?.includedLineCount ?? 0}</span>
                      <span>Est. {money(run.totals?.estimatedTotalCost ?? 0)}</span>
                      <span>Actual {money(run.totals?.actualTotalCost ?? 0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {submittedRuns.length > 0 ? (
            <div className="border-t border-[hsl(var(--e-border))] pt-3">
              <EEyebrow className="mb-2">Recently submitted</EEyebrow>
              <div className="space-y-2">
                {submittedRuns.map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.875rem]"
                  >
                    <div>
                      <p className="font-[550]">{run.name}</p>
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
        <ECardBody className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <EEyebrow>Items to buy</EEyebrow>
              <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
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
          {loadingPlan ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading items…</p>
          ) : planError ? (
            <EInlineNotice tone="danger">{planError}</EInlineNotice>
          ) : groupedRows.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No low-stock items were found for this scope.
            </p>
          ) : (
            groupedRows.map((group) => (
              <div key={group.propertyId} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]">
                <div className="border-b border-[hsl(var(--e-border))] px-4 py-3">
                  <p className="font-[550]">
                    {group.propertyName}{" "}
                    <span className="text-[0.875rem] font-normal text-[hsl(var(--e-muted-foreground))]">({group.suburb})</span>
                  </p>
                </div>
                <div className="divide-y divide-[hsl(var(--e-border))]">
                  {group.rows.map((entry) => (
                    <div
                      key={entry.key}
                      className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_90px_90px_100px] md:items-center"
                    >
                      <div className="min-w-0">
                        <ECheckTile
                          checked={entry.draft.include}
                          onChange={(v) => updateDraft(entry.key, { include: v })}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-[550] text-[hsl(var(--e-foreground))]">
                              {entry.row.item.name}
                            </span>
                            <span className="block truncate text-[0.6875rem] font-normal tracking-normal text-[hsl(var(--e-muted-foreground))]">
                              {entry.row.item.category}
                              {entry.row.item.supplier ? ` · ${entry.row.item.supplier}` : ""} · on hand {entry.row.onHand}{" "}
                              · need {entry.row.needed}
                            </span>
                          </span>
                        </ECheckTile>
                      </div>
                      <EField label="Qty">
                        <EInput
                          type="number"
                          min={0}
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
                      <div>
                        <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">
                          Est.
                        </p>
                        <p className="e-tnum mt-1 text-[0.875rem] font-[550]">
                          {entry.row.estimatedUnitCost != null
                            ? money(Number(entry.draft.plannedQty || 0) * Number(entry.row.estimatedUnitCost))
                            : "—"}
                        </p>
                      </div>
                      <div className="md:text-right">
                        <EBadge tone={priorityTone(entry.priority)} soft>
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
