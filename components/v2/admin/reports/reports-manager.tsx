"use client";

/**
 * Client report PDFs manager (the last Insights tab): search, property,
 * visibility and sort filters, paging, client / cleaner / laundry visibility
 * toggles, regenerate with a theme, PDF download and delete, plus bulk
 * visibility / regenerate / delete on selected rows. Same endpoints as before
 * (/api/admin/reports, /api/admin/report-themes, /api/admin/reports/[jobId]/*,
 * /api/reports/[jobId]/download) and the bulk endpoint.
 *
 * Filters live in the URL (lib/reports/manager-query), so old links to
 * /v2/admin/reports?q=… land here with their filters, and back/forward
 * returns the list as it was. Reads are cancelled when the filters change and
 * checked again after the body is parsed.
 */
import * as React from "react";
import { Palette, RefreshCcw, Search } from "lucide-react";
import { EButton, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { EPagination } from "@/components/v2/ui/pagination";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";
import { downloadFromApi } from "@/lib/client/download";
import { DEFAULT_REPORT_FILTERS, type ReportManagerFilters } from "@/lib/reports/manager-query";
import { ReportBulkActions, type BulkSummary } from "./report-bulk";
import { ReportRowView } from "./report-row";
import { ReportThemePicker } from "./report-theme-picker";
import { DEFAULT_THEME_ID, errorText, isReportList, readThemes, type ReportListBody, type ReportRow, type ThemeOption, type VisibilityPatch } from "./report-types";
import { useReportFilters } from "./use-report-filters";

const INPUT_CLS =
  "h-9 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 " +
  "text-[0.8125rem] text-[hsl(var(--e-foreground))] outline-none transition-colors " +
  "focus:border-[hsl(var(--e-ring))] focus:ring-1 focus:ring-[hsl(var(--e-ring))]";
const LABEL_CLS = "text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-text-faint))]";
const PAGE_SIZE = 25;

function listUrl(filters: ReportManagerFilters, query: string): string {
  const params = new URLSearchParams({ page: String(filters.page), limit: String(PAGE_SIZE), sort: filters.sort });
  if (query) params.set("q", query);
  if (filters.propertyId !== "all") params.set("propertyId", filters.propertyId);
  if (filters.visibility !== "all") params.set("visibility", filters.visibility);
  return `/api/admin/reports?${params.toString()}`;
}

export function ReportsManager({ timeZone = "Australia/Sydney", canManage = true }: { timeZone?: string; canManage?: boolean }) {
  const { filters, setFilters } = useReportFilters();
  const [search, setSearch] = React.useState(filters.q);
  const [list, setList] = React.useState<ReportListBody | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [token, setToken] = React.useState(0);
  const [themes, setThemes] = React.useState<ThemeOption[]>([]);
  const [themeId, setThemeId] = React.useState(DEFAULT_THEME_ID);
  const [showThemePicker, setShowThemePicker] = React.useState(false);
  const [generatingJobId, setGeneratingJobId] = React.useState<string | null>(null);
  const [updatingJobId, setUpdatingJobId] = React.useState<string | null>(null);
  const [toDelete, setToDelete] = React.useState<ReportRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkSummary, setBulkSummary] = React.useState<BulkSummary | null>(null);

  // Keep the search box in step with the URL (back/forward, a new link).
  React.useEffect(() => setSearch(filters.q), [filters.q]);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/report-themes", { signal: controller.signal })
      .then((response) => response.json())
      .then((body: unknown) => {
        if (!controller.signal.aborted) setThemes(readThemes(body));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (search === filters.q) return;
    const timer = window.setTimeout(() => setFilters({ q: search.trim() === "" ? "" : search, page: 1 }), 220);
    return () => window.clearTimeout(timer);
  }, [search, filters.q, setFilters]);

  const url = listUrl(filters, filters.q.trim());
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !isReportList(body)) {
          setLoadError(errorText(body, "Reports could not be loaded."));
          return;
        }
        setList(body);
        setLoadError(null);
      } catch (cause) {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Reports could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [url, token]);

  // A different filter set is a different scope: selection does not carry over.
  React.useEffect(() => setSelected(new Set()), [filters.propertyId, filters.visibility, filters.q]);

  const reload = React.useCallback(() => setToken((value) => value + 1), []);
  const themeQuery = themeId !== DEFAULT_THEME_ID ? themeId : null;
  const themeName = themes.find((theme) => theme.id === themeId)?.name ?? "Default theme";
  const reports = list?.reports ?? [];

  async function downloadReport(jobId: string) {
    try {
      await downloadFromApi(`/api/reports/${jobId}/download`, `job-report-${jobId}.pdf`);
    } catch (error) {
      toast({ title: "Download failed", description: error instanceof Error ? error.message : "Could not export report.", variant: "destructive" });
    }
  }

  async function regenerate(jobId: string) {
    setGeneratingJobId(jobId);
    const qs = themeQuery ? `?themeId=${encodeURIComponent(themeQuery)}` : "";
    const response = await fetch(`/api/admin/reports/${jobId}/generate${qs}`, { method: "POST" }).catch(() => null);
    const body: unknown = await response?.json().catch(() => null);
    setGeneratingJobId(null);
    if (!response?.ok) {
      toast({ title: "Generate failed", description: errorText(body, "Could not regenerate report."), variant: "destructive" });
      return;
    }
    toast({ title: "Report regenerated" });
    reload();
  }

  async function updateVisibility(jobId: string, patch: VisibilityPatch) {
    setUpdatingJobId(jobId);
    const response = await fetch(`/api/admin/reports/${jobId}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    const body: unknown = await response?.json().catch(() => null);
    setUpdatingJobId(null);
    if (!response?.ok) {
      toast({ title: "Visibility update failed", description: errorText(body, "Could not update report visibility."), variant: "destructive" });
      return;
    }
    setList((previous) =>
      previous ? { ...previous, reports: previous.reports.map((row) => (row.jobId === jobId ? { ...row, ...patch } : row)) } : previous,
    );
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const response = await fetch(`/api/admin/reports/${toDelete.jobId}`, { method: "DELETE" }).catch(() => null);
    const body: unknown = await response?.json().catch(() => null);
    setDeleting(false);
    if (!response?.ok) {
      toast({ title: "Delete failed", description: errorText(body, "Could not delete report."), variant: "destructive" });
      return;
    }
    toast({ title: "Report deleted" });
    setToDelete(null);
    reload();
  }

  function onBulkDone(failedIds: string[], summary: BulkSummary) {
    setSelected(new Set(failedIds));
    setBulkSummary(summary);
    reload();
  }

  function selectAllOnPage(checked: boolean) {
    setSelected(checked ? new Set(reports.map((row) => row.jobId)) : new Set());
  }

  const propertyName = (jobId: string) => reports.find((row) => row.jobId === jobId)?.job?.property?.name ?? jobId;
  const allSelected = reports.length > 0 && reports.every((row) => selected.has(row.jobId));

  return (
    <div className="space-y-5">
      <ECard className="p-5">
        <div className="grid gap-4 md:grid-cols-[1.6fr_1fr_1fr_1fr_auto]">
          <label className="space-y-1.5">
            <span className={LABEL_CLS}>Search</span>
            <span className="relative block">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
              <input className={`${INPUT_CLS} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Property, client, or job number" />
            </span>
          </label>
          <label className="space-y-1.5">
            <span className={LABEL_CLS}>Property</span>
            <select className={INPUT_CLS} value={filters.propertyId} onChange={(event) => setFilters({ propertyId: event.target.value, page: 1 })}>
              <option value="all">All properties</option>
              {(list?.properties ?? []).map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name} ({property.suburb})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className={LABEL_CLS}>Client visibility</span>
            <select
              className={INPUT_CLS}
              value={filters.visibility}
              onChange={(event) => setFilters({ visibility: event.target.value as ReportManagerFilters["visibility"], page: 1 })}
            >
              <option value="all">All reports</option>
              <option value="client-visible">Visible to client</option>
              <option value="client-hidden">Hidden from client</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className={LABEL_CLS}>Sort</span>
            <select className={INPUT_CLS} value={filters.sort} onChange={(event) => setFilters({ sort: event.target.value as ReportManagerFilters["sort"], page: 1 })}>
              <option value="newest">Newest first</option>
              <option value="service-date">Service date</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
          <div className="flex items-end">
            <EButton variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_REPORT_FILTERS)}>
              Clear
            </EButton>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--e-border))] pt-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label htmlFor="report-regenerate-theme" className={LABEL_CLS}>Regenerate theme</label>
            <select id="report-regenerate-theme" className={`${INPUT_CLS} w-auto min-w-0 max-w-full sm:min-w-[200px]`} value={themeId} onChange={(event) => setThemeId(event.target.value)}>
              <option value={DEFAULT_THEME_ID}>Use default theme</option>
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                  {theme.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
            <EButton variant="ghost" size="sm" onClick={() => setShowThemePicker(true)}>
              <Palette aria-hidden className="h-3.5 w-3.5" /> Themes
            </EButton>
          </div>
          <EButton variant="outline" size="sm" onClick={reload}>
            <RefreshCcw aria-hidden className="h-3.5 w-3.5" /> Refresh
          </EButton>
        </div>
      </ECard>

      {canManage ? (
        <ReportBulkActions
          selected={Array.from(selected)}
          themeId={themeQuery}
          themeName={themeName}
          onClear={() => setSelected(new Set())}
          onDone={onBulkDone}
        />
      ) : null}
      {bulkSummary ? (
        <div role="status" className="space-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3 text-[0.8125rem]">
          <div className="flex items-center justify-between gap-2">
            <p className="font-[600]">{bulkSummary.text}</p>
            <EButton size="sm" variant="ghost" onClick={() => setBulkSummary(null)}>Dismiss</EButton>
          </div>
          {bulkSummary.failures.length ? (
            <ul className="list-disc pl-5 text-[hsl(var(--e-muted-foreground))]">
              {bulkSummary.failures.map((failure) => (
                <li key={failure.jobId}>{`${propertyName(failure.jobId)}: ${failure.error}`}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ECard>
        {loadError && list ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-warning-soft))] px-4 py-2 text-[0.8125rem]">
            <span>Showing the last loaded reports. {loadError}</span>
            <EButton size="sm" variant="outline" onClick={reload}>Try again</EButton>
          </div>
        ) : null}
        {!list && loading ? (
          <p role="status" className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading reports…</p>
        ) : !list && loadError ? (
          <div role="alert" className="space-y-2 py-12 text-center">
            <p className="text-[0.875rem]">{loadError}</p>
            <EButton size="sm" variant="outline" onClick={reload}>Try again</EButton>
          </div>
        ) : reports.length === 0 ? (
          <EEmptyState
            eyebrow="Reports"
            title="No reports found"
            description="Reports are generated after cleaner submissions. Adjust the filters to widen the search."
            className="border-0"
          />
        ) : (
          <div aria-busy={loading || undefined}>
            {canManage ? (
              <label className="flex items-center gap-2 border-b border-[hsl(var(--e-border))] px-5 py-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                <input type="checkbox" className="h-[15px] w-[15px] accent-[hsl(var(--e-primary))]" checked={allSelected} onChange={(event) => selectAllOnPage(event.target.checked)} />
                Select all on this page
              </label>
            ) : null}
            {reports.map((report) => (
              <ReportRowView
                key={report.id}
                report={report}
                timeZone={timeZone}
                selected={selected.has(report.jobId)}
                onSelect={(checked) =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (checked) next.add(report.jobId);
                    else next.delete(report.jobId);
                    return next;
                  })
                }
                canManage={canManage}
                busy={updatingJobId === report.jobId}
                generating={generatingJobId === report.jobId}
                onToggle={(patch) => void updateVisibility(report.jobId, patch)}
                onDownload={() => void downloadReport(report.jobId)}
                onRegenerate={() => void regenerate(report.jobId)}
                onDelete={() => setToDelete(report)}
              />
            ))}
          </div>
        )}
      </ECard>

      {list ? (
        <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-5 py-3">
          <EPagination
            page={list.pagination.page}
            pageSize={list.pagination.limit}
            total={list.pagination.totalCount}
            onPageChange={(page) => setFilters({ page })}
            disabled={loading}
            noun="reports"
          />
        </div>
      ) : null}

      <ReportThemePicker
        open={showThemePicker}
        themes={themes}
        selectedId={themeId}
        onClose={() => setShowThemePicker(false)}
        onSelect={(theme) => {
          setThemeId(theme.id);
          setShowThemePicker(false);
          toast({ title: "Regenerate theme set", description: theme.name });
        }}
      />

      <EConfirmModal
        open={toDelete !== null}
        onClose={() => (deleting ? undefined : setToDelete(null))}
        title="Delete report"
        description={
          <>
            This removes the generated report file and metadata for{" "}
            <span className="font-[550] text-[hsl(var(--e-foreground))]">{toDelete?.job?.property?.name ?? "this job"}</span>.
          </>
        }
        confirmLabel={deleting ? "Deleting…" : "Delete report"}
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
