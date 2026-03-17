"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { RefreshCw, CheckCircle2, AlertTriangle, History, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

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
  summary: Record<string, any> | null;
  property: {
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
  triggeredBy: { id: string; name: string | null; email: string | null } | null;
  revertedBy: { id: string; name: string | null; email: string | null } | null;
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
const MODE_OPTIONS = ["all", "MANUAL", "AUTO"] as const;

function statusTone(status: string) {
  switch (status) {
    case "SUCCESS":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "ERROR":
      return "border-red-200 bg-red-50 text-red-700";
    case "RUNNING":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "REVERTED":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-border bg-muted text-foreground";
  }
}

export default function AdminIcalIntegrationsPage() {
  const [payload, setPayload] = useState<Payload>({
    runs: [],
    properties: [],
    summary: { totalRuns: 0, totalProperties: 0, syncableProperties: 0, statusCounts: {} },
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filters, setFilters] = useState({
    propertyId: "all",
    status: "all",
    mode: "all",
    q: "",
  });
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [lastBulkResult, setLastBulkResult] = useState<{
    requested: number;
    succeeded: number;
    failed: number;
    results: Array<{ propertyId: string; propertyName: string; suburb: string; ok: boolean; error?: string }>;
  } | null>(null);

  async function loadData() {
    setLoading(true);
    const query = new URLSearchParams();
    if (filters.propertyId && filters.propertyId !== "all") query.set("propertyId", filters.propertyId);
    if (filters.status && filters.status !== "all") query.set("status", filters.status);
    if (filters.mode && filters.mode !== "all") query.set("mode", filters.mode);
    if (filters.q.trim()) query.set("q", filters.q.trim());

    const res = await fetch(`/api/admin/integrations/ical-sync-runs?${query.toString()}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      toast({
        title: "Load failed",
        description: body?.error ?? "Could not load iCal sync history.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
    setPayload(body);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.propertyId, filters.status, filters.mode]);

  const syncableProperties = useMemo(
    () => payload.properties.filter((property) => property.integration?.isEnabled && property.integration?.icalUrl),
    [payload.properties]
  );

  const propertySelectionList = useMemo(() => {
    const term = filters.q.trim().toLowerCase();
    return syncableProperties.filter((property) => {
      if (!term) return true;
      return (
        property.name.toLowerCase().includes(term) ||
        property.suburb.toLowerCase().includes(term)
      );
    });
  }, [filters.q, syncableProperties]);

  function toggleProperty(propertyId: string, checked: boolean) {
    setSelectedPropertyIds((prev) => {
      if (checked) return Array.from(new Set([...prev, propertyId]));
      return prev.filter((value) => value !== propertyId);
    });
  }

  function toggleAllFiltered(checked: boolean) {
    if (checked) {
      setSelectedPropertyIds(Array.from(new Set([...selectedPropertyIds, ...propertySelectionList.map((property) => property.id)])));
      return;
    }
    const hiddenIds = new Set(propertySelectionList.map((property) => property.id));
    setSelectedPropertyIds((prev) => prev.filter((value) => !hiddenIds.has(value)));
  }

  async function runBulkResync() {
    if (selectedPropertyIds.length === 0) {
      toast({
        title: "No properties selected",
        description: "Select at least one sync-enabled property first.",
        variant: "destructive",
      });
      return;
    }
    setSyncing(true);
    const res = await fetch("/api/admin/integrations/ical-sync-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyIds: selectedPropertyIds }),
    });
    const body = await res.json().catch(() => null);
    setSyncing(false);
    if (!res.ok || !body) {
      toast({
        title: "Bulk re-sync failed",
        description: body?.error ?? "Could not re-sync selected properties.",
        variant: "destructive",
      });
      return;
    }
    setLastBulkResult(body);
    toast({
      title: "Bulk re-sync finished",
      description: `${body.succeeded} succeeded, ${body.failed} failed.`,
    });
    await loadData();
  }

  const allFilteredSelected =
    propertySelectionList.length > 0 &&
    propertySelectionList.every((property) => selectedPropertyIds.includes(property.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">iCal Sync Ops</h2>
          <p className="text-sm text-muted-foreground">
            Monitor every iCal sync run across all properties, verify issues, and re-sync selected properties in bulk.
          </p>
        </div>
        <Button variant="outline" onClick={loadData} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Runs Loaded</p>
            <p className="mt-2 text-2xl font-semibold">{payload.summary.totalRuns}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Properties</p>
            <p className="mt-2 text-2xl font-semibold">{payload.summary.totalProperties}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Syncable</p>
            <p className="mt-2 text-2xl font-semibold">{payload.summary.syncableProperties}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Errors</p>
            <p className="mt-2 text-2xl font-semibold">{payload.summary.statusCounts.ERROR ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1.4fr_220px_180px_180px_auto]">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={filters.q}
                onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
                placeholder="Property, suburb, user, or error"
                onKeyDown={(event) => {
                  if (event.key === "Enter") loadData();
                }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Property</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={filters.propertyId}
              onChange={(event) => setFilters((prev) => ({ ...prev, propertyId: event.target.value }))}
            >
              <option value="all">All properties</option>
              {payload.properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name} ({property.suburb})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Status</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status === "all" ? "All statuses" : status}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Mode</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={filters.mode}
              onChange={(event) => setFilters((prev) => ({ ...prev, mode: event.target.value }))}
            >
              {MODE_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === "all" ? "All modes" : mode}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={loadData} disabled={loading} className="w-full">
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[360px,1fr]">
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="text-base">Bulk Re-sync Selected Properties</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select sync-enabled properties and run a manual re-sync across all of them.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={(event) => toggleAllFiltered(event.target.checked)}
              />
              Select all filtered syncable properties
            </label>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {propertySelectionList.map((property) => {
                const checked = selectedPropertyIds.includes(property.id);
                return (
                  <label
                    key={property.id}
                    className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => toggleProperty(property.id, event.target.checked)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{property.name}</p>
                      <p className="text-xs text-muted-foreground">{property.suburb}</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <Badge variant="outline" className={statusTone(property.integration?.syncStatus ?? "IDLE")}>
                          {property.integration?.syncStatus ?? "IDLE"}
                        </Badge>
                        {property.integration?.lastSyncAt ? (
                          <span className="text-[11px] text-muted-foreground">
                            Last sync {format(new Date(property.integration.lastSyncAt), "dd MMM HH:mm")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </label>
                );
              })}
              {propertySelectionList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sync-enabled properties match the current filter.</p>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{selectedPropertyIds.length} selected</p>
              <Button onClick={runBulkResync} disabled={syncing || selectedPropertyIds.length === 0}>
                <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Re-syncing..." : "Re-sync selected"}
              </Button>
            </div>
            {lastBulkResult ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">
                  Last bulk run: {lastBulkResult.succeeded} succeeded, {lastBulkResult.failed} failed
                </p>
                <div className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1 text-xs">
                  {lastBulkResult.results.map((result) => (
                    <div key={result.propertyId} className="rounded border bg-background px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {result.propertyName} ({result.suburb})
                        </span>
                        {result.ok ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-700">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Failed
                          </span>
                        )}
                      </div>
                      {result.error ? <p className="mt-1 text-red-700">{result.error}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              Global Sync History
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Latest 200 runs matching the current filters.
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading sync runs...</p>
            ) : payload.runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sync runs match the current filters.</p>
            ) : (
              <div className="space-y-3">
                {payload.runs.map((run) => {
                  const summary = run.summary ?? {};
                  const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
                  return (
                    <div key={run.id} className="rounded-xl border p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/admin/properties/${run.property.id}`} className="font-semibold hover:underline">
                              {run.property.name}
                            </Link>
                            <span className="text-sm text-muted-foreground">({run.property.suburb})</span>
                            <Badge variant="outline" className={statusTone(run.status)}>
                              {run.status}
                            </Badge>
                            <Badge variant="outline">{run.mode}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Started {format(new Date(run.createdAt), "dd MMM yyyy HH:mm")}
                            {run.completedAt ? ` • Completed ${format(new Date(run.completedAt), "dd MMM HH:mm")}` : ""}
                            {run.revertedAt ? ` • Reverted ${format(new Date(run.revertedAt), "dd MMM HH:mm")}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            By {run.triggeredBy?.name || run.triggeredBy?.email || "System"}
                            {run.revertedBy ? ` • Reverted by ${run.revertedBy.name || run.revertedBy.email}` : ""}
                          </p>
                        </div>
                        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:min-w-[320px]">
                          <span>Reservations +{summary.reservationsCreated ?? 0}</span>
                          <span>Reservations updated {summary.reservationsUpdated ?? 0}</span>
                          <span>Jobs +{summary.jobsCreated ?? 0}</span>
                          <span>Jobs updated {summary.jobsUpdated ?? 0}</span>
                          <span>Feed duplicates {summary.duplicateFeedEvents ?? 0}</span>
                          <span>Job conflicts skipped {summary.jobsSkippedConflict ?? 0}</span>
                        </div>
                      </div>
                      {warnings.length > 0 ? (
                        <div className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
                          {warnings.map((warning: string, index: number) => (
                            <p key={`${run.id}-${index}`}>{warning}</p>
                          ))}
                        </div>
                      ) : null}
                      {run.error ? (
                        <div className="mt-3 rounded-md bg-red-50 p-3 text-xs text-red-700">{run.error}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
