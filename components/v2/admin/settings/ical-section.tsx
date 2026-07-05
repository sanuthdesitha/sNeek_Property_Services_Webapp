"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";
import { EBadge, EButton, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { EInput, ESelectNative, ESaveStatus, ESectionHeading, useSaveStatus } from "./estate-form";

type PropertyRow = {
  id: string;
  name: string;
  suburb: string;
  integration: {
    id: string;
    isEnabled: boolean;
    icalUrl: string | null;
    syncStatus: string;
    lastSyncAt: string | null;
  } | null;
};

type SyncRunRow = {
  id: string;
  mode: string;
  status: string;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  revertedAt: string | null;
  property: { id: string; name: string; suburb: string };
  triggeredBy: { id: string; name: string | null; email: string | null } | null;
};

type Payload = {
  runs: SyncRunRow[];
  properties: PropertyRow[];
  summary: {
    totalRuns: number;
    totalProperties: number;
    syncableProperties: number;
    statusCounts: Record<string, number>;
  };
};

const STATUS_OPTIONS = ["all", "RUNNING", "SUCCESS", "ERROR", "REVERTED"] as const;

function runTone(status: string): "success" | "danger" | "info" | "warning" | "neutral" {
  switch (status) {
    case "SUCCESS": return "success";
    case "ERROR": return "danger";
    case "RUNNING": return "info";
    case "REVERTED": return "warning";
    default: return "neutral";
  }
}

/**
 * iCal sync — reads /api/admin/integrations/ical-sync-runs and bulk re-syncs
 * selected properties through the same POST endpoint the v1 ops console uses.
 */
export function IcalSection() {
  const [payload, setPayload] = useState<Payload>({
    runs: [],
    properties: [],
    summary: { totalRuns: 0, totalProperties: 0, syncableProperties: 0, statusCounts: {} },
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { status, flash } = useSaveStatus();

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    params.set("limit", "30");
    try {
      const res = await fetch(`/api/admin/integrations/ical-sync-runs?${params.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        flash("error", body?.error ?? "Could not load sync history.");
        return;
      }
      setPayload(body);
    } catch {
      flash("error", "Could not load sync history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const syncable = useMemo(
    () => payload.properties.filter((p) => p.integration?.isEnabled && p.integration?.icalUrl),
    [payload.properties]
  );
  const filteredProperties = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return syncable;
    return syncable.filter(
      (p) => p.name.toLowerCase().includes(term) || p.suburb.toLowerCase().includes(term)
    );
  }, [syncable, query]);

  const allSelected =
    filteredProperties.length > 0 && filteredProperties.every((p) => selectedIds.includes(p.id));

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  function toggleAll() {
    if (allSelected) {
      const visible = new Set(filteredProperties.map((p) => p.id));
      setSelectedIds((prev) => prev.filter((v) => !visible.has(v)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredProperties.map((p) => p.id)])));
    }
  }

  async function resync() {
    if (selectedIds.length === 0) {
      flash("error", "Select at least one sync-enabled property.");
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/integrations/ical-sync-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds: selectedIds }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        flash("error", body?.error ?? "Bulk re-sync failed.");
        return;
      }
      flash("saved", `Re-sync finished — ${body.succeeded} succeeded, ${body.failed} failed`);
      setSelectedIds([]);
      await load();
    } catch {
      flash("error", "Bulk re-sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Reservations"
        title="iCal sync"
        description="Every calendar sync run across all properties, with bulk re-sync for the ones that need a nudge."
        actions={
          <EButton variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </EButton>
        }
      />

      {/* Summary strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Runs loaded", value: payload.summary.totalRuns },
          { label: "Properties", value: payload.summary.totalProperties },
          { label: "Sync-enabled", value: payload.summary.syncableProperties },
        ].map((tile) => (
          <ECard key={tile.label} className="p-5">
            <p className="e-eyebrow">{tile.label}</p>
            <p className="e-numeral mt-2 text-[1.75rem] leading-none">{tile.value}</p>
          </ECard>
        ))}
      </div>

      {/* Bulk re-sync */}
      <ECard className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[1rem] font-semibold tracking-[-0.01em]">Re-sync properties</h3>
            <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Select sync-enabled properties and pull their calendars again.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ESaveStatus status={status} />
            <EButton onClick={resync} disabled={syncing || selectedIds.length === 0}>
              {syncing ? "Syncing…" : `Re-sync ${selectedIds.length || ""}`.trim()}
            </EButton>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <EInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or suburb…"
            className="max-w-xs"
          />
          <button
            type="button"
            onClick={toggleAll}
            className="text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))] hover:underline"
          >
            {allSelected ? "Clear visible" : "Select visible"}
          </button>
        </div>
        <div className="mt-4 max-h-72 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
          {filteredProperties.length === 0 ? (
            <p className="px-4 py-8 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              No sync-enabled properties match.
            </p>
          ) : (
            filteredProperties.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center justify-between gap-3 border-b border-[hsl(var(--e-border)/0.7)] px-4 py-2.5 last:border-b-0 transition-colors hover:bg-[hsl(var(--e-muted))]"
              >
                <span className="flex items-center gap-3 text-[0.875rem]">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(p.id)}
                    onChange={() => toggle(p.id)}
                    className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                  />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[hsl(var(--e-text-faint))]">{p.suburb}</span>
                </span>
                <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                  {p.integration?.lastSyncAt
                    ? `Synced ${format(new Date(p.integration.lastSyncAt), "dd MMM HH:mm")}`
                    : "Never synced"}
                </span>
              </label>
            ))
          )}
        </div>
      </ECard>

      {/* Run history */}
      <ECard>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-6 py-4">
          <h3 className="text-[1rem] font-semibold tracking-[-0.01em]">Recent runs</h3>
          <ESelectNative
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_OPTIONS)[number])}
            className="h-9 w-40"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === "all" ? "All statuses" : opt.charAt(0) + opt.slice(1).toLowerCase()}
              </option>
            ))}
          </ESelectNative>
        </div>
        <div className="p-2">
          {payload.runs.length === 0 ? (
            <EEmptyState eyebrow="Quiet" title="No sync runs yet" description="Runs appear here once a calendar sync executes." className="border-0" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="text-left">
                    {["Property", "Status", "Mode", "Started", "Triggered by"].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payload.runs.map((run) => (
                    <tr key={run.id} className="border-t border-[hsl(var(--e-border)/0.7)]">
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{run.property.name}</span>{" "}
                        <span className="text-[hsl(var(--e-text-faint))]">{run.property.suburb}</span>
                        {run.error ? (
                          <p className="mt-0.5 max-w-md truncate text-[0.75rem] text-[hsl(var(--e-danger))]">{run.error}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <EBadge tone={runTone(run.status)} soft>{run.status}</EBadge>
                      </td>
                      <td className="px-4 py-2.5 text-[hsl(var(--e-text-secondary))]">{run.mode}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-[hsl(var(--e-text-secondary))]">
                        {format(new Date(run.createdAt), "dd MMM HH:mm")}
                      </td>
                      <td className="px-4 py-2.5 text-[hsl(var(--e-text-secondary))]">
                        {run.triggeredBy?.name ?? run.triggeredBy?.email ?? "System"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Deeper filters and revert tools live in the{" "}
        <Link href="/admin/settings?tab=ical-sync" className="text-[hsl(var(--e-gold-ink))] hover:underline">
          classic iCal console
        </Link>
        .
      </p>
    </div>
  );
}
