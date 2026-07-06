"use client";

/**
 * ESTATE laundry history — the v2 History surface. Fetches the SAME endpoint
 * the v1 history view uses (GET /api/laundry/history → up to 300 LaundryTask
 * records, newest first, with property/supplier/job/confirmations included) and
 * renders it natively in Estate chrome: a searchable / status- and date-
 * filterable table grouped by day with per-day subtotals.
 *
 * Zero imports from live components/ui/* or components/laundry/*. UI comes only
 * from components/v2/ui/primitives + components/v2/admin/estate-kit.
 */
import * as React from "react";
import { format } from "date-fns";
import { PackageCheck, RefreshCw, Search, Weight } from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETableShell } from "@/components/v2/admin/estate-kit";

type LaundryStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PICKED_UP"
  | "DROPPED"
  | "FLAGGED"
  | "SKIPPED_PICKUP";

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

const STATUS_TONE: Record<LaundryStatus, Tone> = {
  PENDING: "neutral",
  CONFIRMED: "primary",
  PICKED_UP: "info",
  DROPPED: "success",
  FLAGGED: "danger",
  SKIPPED_PICKUP: "warning",
};

const STATUS_LABEL: Record<LaundryStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PICKED_UP: "Picked up",
  DROPPED: "Delivered",
  FLAGGED: "Flagged",
  SKIPPED_PICKUP: "Skipped",
};

const STATUS_ORDER: LaundryStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PICKED_UP",
  "DROPPED",
  "FLAGGED",
  "SKIPPED_PICKUP",
];

/* ── Types (mirror the /api/laundry/history payload) ───────────────────── */
type HistoryTask = {
  id: string;
  status: string;
  pickupDate: string;
  dropoffDate: string;
  pickedUpAt?: string | null;
  droppedAt?: string | null;
  bagWeightKg?: number | null;
  dropoffCostAud?: number | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  property?: { name?: string | null; suburb?: string | null } | null;
  supplier?: { name?: string | null } | null;
};

function toneFor(status: string): Tone {
  return STATUS_TONE[status as LaundryStatus] ?? "neutral";
}
function labelFor(status: string): string {
  return STATUS_LABEL[status as LaundryStatus] ?? status;
}

function propertyLabel(t: HistoryTask): string {
  const name = t.property?.name ?? "Property";
  const suburb = t.property?.suburb ?? "";
  return suburb ? `${name}, ${suburb}` : name;
}

/** The date a history row "happened" — delivered/updated timestamp, best available. */
function eventDate(t: HistoryTask): Date {
  const raw = t.droppedAt ?? t.updatedAt ?? t.pickedUpAt ?? t.dropoffDate ?? t.pickupDate ?? t.createdAt;
  return raw ? new Date(raw) : new Date(0);
}

function dayKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function HistoryBoard() {
  const [tasks, setTasks] = React.useState<HistoryTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [forbidden, setForbidden] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<"ALL" | LaundryStatus>("ALL");
  const [dateFilter, setDateFilter] = React.useState("");

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch("/api/laundry/history", { cache: "no-store" });
      if (res.status === 403) {
        setForbidden(true);
        setTasks([]);
        setErrorMsg(null);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMsg((data && data.error) || "The laundry history could not be loaded.");
        setTasks([]);
        return;
      }
      setForbidden(false);
      setErrorMsg(null);
      setTasks(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "The laundry history could not be loaded.");
      setTasks([]);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  /* ── Client-side filters ─────────────────────────────────────────────── */
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (status !== "ALL" && t.status !== status) return false;
      if (q) {
        const hay = `${t.property?.name ?? ""} ${t.property?.suburb ?? ""} ${t.supplier?.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (dateFilter) {
        if (dayKey(eventDate(t)) !== dateFilter) return false;
      }
      return true;
    });
  }, [tasks, query, status, dateFilter]);

  /* ── Group by event day (newest first), with per-day subtotals ───────── */
  const groups = React.useMemo(() => {
    const map = new Map<string, HistoryTask[]>();
    for (const t of filtered) {
      const key = dayKey(eventDate(t));
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return Array.from(map.entries())
      .sort((a: [string, HistoryTask[]], b: [string, HistoryTask[]]) => b[0].localeCompare(a[0]))
      .map(([key, rows]) => {
        const kg = rows.reduce((s, r) => s + (r.bagWeightKg ?? 0), 0);
        const cost = rows.reduce((s, r) => s + (r.dropoffCostAud ?? 0), 0);
        return { key, rows, kg, cost };
      });
  }, [filtered]);

  const totalKg = filtered.reduce((s, t) => s + (t.bagWeightKg ?? 0), 0);
  const hasFilters = Boolean(query.trim() || status !== "ALL" || dateFilter);

  if (forbidden) {
    return (
      <EAlert tone="info" title="History is not available">
        Laundry history has not been enabled for your account. Ask an administrator to turn it on if
        you need to review past pickups and deliveries.
      </EAlert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <ECard>
        <ECardBody className="pt-6">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <EField label="Search property or supplier">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
                <EInput
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. Bondi, Acme Linen…"
                  className="pl-9"
                />
              </div>
            </EField>
            <EField label="Status">
              <ESelect value={status} onChange={(e) => setStatus(e.target.value as "ALL" | LaundryStatus)}>
                <option value="ALL">All statuses</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Date">
              <EInput type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
            </EField>
            <div className="flex items-center gap-2">
              {hasFilters ? (
                <EButton
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setStatus("ALL");
                    setDateFilter("");
                  }}
                >
                  Clear
                </EButton>
              ) : null}
              <EButton variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </EButton>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            <span className="inline-flex items-center gap-1.5">
              <PackageCheck className="h-3.5 w-3.5" />
              {filtered.length} task{filtered.length === 1 ? "" : "s"}
            </span>
            {totalKg > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Weight className="h-3.5 w-3.5" />
                {totalKg.toFixed(1)} kg total
              </span>
            ) : null}
          </div>
        </ECardBody>
      </ECard>

      {errorMsg ? <EAlert tone="danger" title="Could not load history">{errorMsg}</EAlert> : null}

      {/* Grouped history */}
      {groups.length === 0 ? (
        <EEmptyState
          eyebrow="Quiet"
          title={loading ? "Loading history…" : hasFilters ? "No matching tasks" : "No laundry history yet"}
          description={
            loading
              ? "Fetching past laundry tasks."
              : hasFilters
                ? "No past laundry tasks match these filters."
                : "Completed and past laundry tasks will appear here."
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <ECard key={g.key}>
              <ECardBody className="pt-6">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-gold-ink))]">
                    {format(new Date(`${g.key}T00:00:00`), "EEEE d MMMM yyyy")}
                  </p>
                  <div className="flex items-center gap-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <span className="e-tnum">{g.rows.length} task{g.rows.length === 1 ? "" : "s"}</span>
                    {g.kg > 0 ? <span className="e-tnum">{g.kg.toFixed(1)} kg</span> : null}
                    {g.cost > 0 ? <span className="e-tnum">${g.cost.toFixed(0)}</span> : null}
                  </div>
                </div>

                <ETableShell
                  headers={[
                    { label: "Property" },
                    { label: "Supplier" },
                    { label: "Status" },
                    { label: "Weight", align: "right" },
                    { label: "Cost", align: "right" },
                    { label: "Returned", align: "right" },
                  ]}
                >
                  {g.rows.map((t) => (
                    <tr key={t.id}>
                      <td className="px-4 py-3">
                        <p className="min-w-0 truncate font-medium">{propertyLabel(t)}</p>
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--e-muted-foreground))]">
                        {t.supplier?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <EBadge tone={toneFor(t.status)} soft>
                          {labelFor(t.status)}
                        </EBadge>
                      </td>
                      <td className="e-tnum px-4 py-3 text-right text-[hsl(var(--e-muted-foreground))]">
                        {t.bagWeightKg ? `${t.bagWeightKg.toFixed(1)} kg` : "—"}
                      </td>
                      <td className="e-tnum px-4 py-3 text-right text-[hsl(var(--e-muted-foreground))]">
                        {t.dropoffCostAud ? `$${t.dropoffCostAud.toFixed(0)}` : "—"}
                      </td>
                      <td className="e-tnum px-4 py-3 text-right text-[hsl(var(--e-muted-foreground))]">
                        {t.droppedAt ? format(new Date(t.droppedAt), "HH:mm") : "—"}
                      </td>
                    </tr>
                  ))}
                </ETableShell>
              </ECardBody>
            </ECard>
          ))}
        </div>
      )}
    </div>
  );
}
