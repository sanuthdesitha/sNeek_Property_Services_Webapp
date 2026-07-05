"use client";

/**
 * ESTATE reports manager — search, property + visibility filters, pagination,
 * visibility toggles, regenerate (with theme), PDF and delete. Same endpoints
 * as the legacy manager (/api/admin/reports, /api/admin/report-themes,
 * /api/admin/reports/[jobId]/*, /api/reports/[jobId]/download); new Estate UI.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Download, FileText, RefreshCcw, Search, Trash2, X } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { toast } from "@/hooks/use-toast";
import { downloadFromApi } from "@/lib/client/download";

const INPUT_CLS =
  "h-9 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 " +
  "text-[0.8125rem] text-[hsl(var(--e-foreground))] outline-none transition-colors " +
  "focus:border-[hsl(var(--e-ring))] focus:ring-1 focus:ring-[hsl(var(--e-ring))]";

const LABEL_CLS = "text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-text-faint))]";

export function ReportsManager() {
  const [reports, setReports] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ q: "", propertyId: "all", visibility: "all", sort: "newest" });
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, totalCount: 0, totalPages: 1, hasMore: false });
  const [generatingJobId, setGeneratingJobId] = useState<string | null>(null);
  const [updatingVisibility, setUpdatingVisibility] = useState<string | null>(null);
  const [reportToDelete, setReportToDelete] = useState<any | null>(null);
  const [deletingReport, setDeletingReport] = useState(false);
  const [themes, setThemes] = useState<Array<{ id: string; name: string; kind: string; isDefault: boolean }>>([]);
  const [exportThemeId, setExportThemeId] = useState("__default__");

  useEffect(() => {
    fetch("/api/admin/report-themes")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.themes)) setThemes(data.themes);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(filters.q.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  async function loadReports() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "25", sort: filters.sort });
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (filters.propertyId !== "all") params.set("propertyId", filters.propertyId);
    if (filters.visibility !== "all") params.set("visibility", filters.visibility);
    const res = await fetch(`/api/admin/reports?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    setReports(Array.isArray(data?.reports) ? data.reports : []);
    setProperties(Array.isArray(data?.properties) ? data.properties : []);
    setPagination(data?.pagination ?? { page: 1, limit: 25, totalCount: 0, totalPages: 1, hasMore: false });
    setLoading(false);
  }

  useEffect(() => {
    void loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedQuery, filters.propertyId, filters.sort, filters.visibility]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, filters.propertyId, filters.sort, filters.visibility]);

  async function downloadReport(jobId: string) {
    try {
      await downloadFromApi(`/api/reports/${jobId}/download`, `job-report-${jobId}.pdf`);
    } catch (error: any) {
      toast({ title: "Download failed", description: error?.message ?? "Could not export report.", variant: "destructive" });
    }
  }

  async function regenerateReport(jobId: string) {
    setGeneratingJobId(jobId);
    const qs = exportThemeId && exportThemeId !== "__default__" ? `?themeId=${encodeURIComponent(exportThemeId)}` : "";
    const res = await fetch(`/api/admin/reports/${jobId}/generate${qs}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setGeneratingJobId(null);
    if (!res.ok) {
      toast({ title: "Generate failed", description: body.error ?? "Could not regenerate report.", variant: "destructive" });
      return;
    }
    toast({ title: "Report regenerated" });
    void loadReports();
  }

  async function updateVisibility(
    jobId: string,
    patch: { clientVisible?: boolean; cleanerVisible?: boolean; laundryVisible?: boolean }
  ) {
    setUpdatingVisibility(jobId);
    const res = await fetch(`/api/admin/reports/${jobId}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    setUpdatingVisibility(null);
    if (!res.ok) {
      toast({ title: "Visibility update failed", description: body.error ?? "Could not update report visibility.", variant: "destructive" });
      return;
    }
    setReports((prev) =>
      prev.map((report) =>
        report.jobId === jobId
          ? { ...report, ...patch, visibilityUpdatedAt: body.visibilityUpdatedAt, visibilityUpdatedBy: body.visibilityUpdatedBy }
          : report
      )
    );
  }

  async function deleteReport() {
    if (!reportToDelete) return;
    setDeletingReport(true);
    const res = await fetch(`/api/admin/reports/${reportToDelete.jobId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setDeletingReport(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete report.", variant: "destructive" });
      return;
    }
    toast({ title: "Report deleted" });
    setReportToDelete(null);
    void loadReports();
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <ECard className="p-5">
        <div className="grid gap-4 md:grid-cols-[1.6fr_1fr_1fr_1fr_auto]">
          <div className="space-y-1.5">
            <p className={LABEL_CLS}>Search</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
              <input
                className={`${INPUT_CLS} pl-9`}
                value={filters.q}
                onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
                placeholder="Property, client, or job number"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <p className={LABEL_CLS}>Property</p>
            <select
              className={INPUT_CLS}
              value={filters.propertyId}
              onChange={(event) => setFilters((prev) => ({ ...prev, propertyId: event.target.value }))}
            >
              <option value="all">All properties</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name} ({property.suburb})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <p className={LABEL_CLS}>Client visibility</p>
            <select
              className={INPUT_CLS}
              value={filters.visibility}
              onChange={(event) => setFilters((prev) => ({ ...prev, visibility: event.target.value }))}
            >
              <option value="all">All reports</option>
              <option value="client-visible">Visible to client</option>
              <option value="client-hidden">Hidden from client</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <p className={LABEL_CLS}>Sort</p>
            <select
              className={INPUT_CLS}
              value={filters.sort}
              onChange={(event) => setFilters((prev) => ({ ...prev, sort: event.target.value }))}
            >
              <option value="newest">Newest first</option>
              <option value="service-date">Service date</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
          <div className="flex items-end">
            <EButton
              variant="ghost"
              size="sm"
              onClick={() => setFilters({ q: "", propertyId: "all", visibility: "all", sort: "newest" })}
            >
              Clear
            </EButton>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--e-border))] pt-4">
          <div className="flex items-center gap-2">
            <p className={LABEL_CLS}>Regenerate theme</p>
            <select
              className={`${INPUT_CLS} w-auto min-w-[200px]`}
              value={exportThemeId}
              onChange={(event) => setExportThemeId(event.target.value)}
            >
              <option value="__default__">Use default theme</option>
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                  {theme.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
            <Link
              href="/admin/reports/themes"
              className="text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))] underline-offset-4 hover:underline"
            >
              Manage themes (classic) →
            </Link>
          </div>
          <EButton variant="outline" size="sm" onClick={() => void loadReports()}>
            <RefreshCcw className="h-3.5 w-3.5" /> Refresh
          </EButton>
        </div>
      </ECard>

      {/* Rows */}
      <ECard>
        {loading ? (
          <p className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading reports…</p>
        ) : reports.length === 0 ? (
          <EEmptyState
            eyebrow="Reports"
            title="No reports found"
            description="Reports are generated after cleaner submissions. Adjust the filters to widen the search."
            className="border-0"
          />
        ) : (
          <div>
            {reports.map((report) => (
              <div
                key={report.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-5 py-4 last:border-0 hover:bg-[hsl(var(--e-muted))]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <Link
                      href={`/v2/admin/jobs/${report.jobId}`}
                      className="block truncate text-[0.875rem] font-[550] hover:underline"
                    >
                      {report.job?.property?.name ?? "Property"}
                    </Link>
                    <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {report.job?.property?.client?.name ?? "—"} ·{" "}
                      {String(report.job?.jobType ?? "").replace(/_/g, " ")} ·{" "}
                      {report.job?.scheduledDate ? format(new Date(report.job.scheduledDate), "dd MMM yyyy") : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {report.sentToClient ? <EBadge tone="success" soft>Sent to client</EBadge> : null}
                  <button
                    type="button"
                    disabled={updatingVisibility === report.jobId}
                    onClick={() => void updateVisibility(report.jobId, { clientVisible: !report.clientVisible })}
                    className="disabled:opacity-50"
                    title="Toggle client visibility"
                  >
                    <EBadge tone={report.clientVisible ? "gold" : "neutral"} soft={report.clientVisible}>
                      {report.clientVisible ? "Client sees it" : "Hidden from client"}
                    </EBadge>
                  </button>
                  <button
                    type="button"
                    disabled={updatingVisibility === report.jobId}
                    onClick={() => void updateVisibility(report.jobId, { cleanerVisible: !report.cleanerVisible })}
                    className="disabled:opacity-50"
                    title="Toggle cleaner visibility"
                  >
                    <EBadge tone={report.cleanerVisible ? "info" : "neutral"} soft={report.cleanerVisible}>
                      {report.cleanerVisible ? "Cleaner sees it" : "Hidden from cleaner"}
                    </EBadge>
                  </button>
                  <EButton variant="ghost" size="sm" onClick={() => void downloadReport(report.jobId)}>
                    <Download className="h-3.5 w-3.5" /> PDF
                  </EButton>
                  <EButton
                    variant="ghost"
                    size="sm"
                    disabled={generatingJobId === report.jobId}
                    onClick={() => void regenerateReport(report.jobId)}
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    {generatingJobId === report.jobId ? "Generating…" : "Regenerate"}
                  </EButton>
                  <EButton
                    variant="ghost"
                    size="sm"
                    className="text-[hsl(var(--e-danger))] hover:text-[hsl(var(--e-danger))]"
                    onClick={() => setReportToDelete(report)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </EButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </ECard>

      {/* Pagination */}
      <div className="flex items-center justify-between rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-5 py-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Page <span className="e-numeral">{pagination.page}</span> of{" "}
          <span className="e-numeral">{pagination.totalPages}</span> ·{" "}
          <span className="e-numeral">{pagination.totalCount}</span> reports
        </p>
        <div className="flex items-center gap-2">
          <EButton variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            <ChevronLeft className="h-3.5 w-3.5" /> Previous
          </EButton>
          <EButton variant="outline" size="sm" disabled={!pagination.hasMore} onClick={() => setPage((current) => current + 1)}>
            Next <ChevronRight className="h-3.5 w-3.5" />
          </EButton>
        </div>
      </div>

      {/* Delete confirm */}
      {reportToDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setReportToDelete(null)} />
          <div className="relative w-full max-w-md rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-6 shadow-[var(--e-elevation-3)]">
            <div className="flex items-start justify-between gap-3">
              <p className="e-display-sm">Delete report</p>
              <button
                type="button"
                onClick={() => setReportToDelete(null)}
                aria-label="Close"
                className="rounded-[var(--e-radius-sm)] p-1 text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              This removes the generated report file and metadata for{" "}
              <span className="font-[550] text-[hsl(var(--e-foreground))]">
                {reportToDelete.job?.property?.name ?? "this job"}
              </span>
              .
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <EButton variant="outline" size="sm" onClick={() => setReportToDelete(null)} disabled={deletingReport}>
                Cancel
              </EButton>
              <EButton variant="danger" size="sm" onClick={() => void deleteReport()} disabled={deletingReport}>
                {deletingReport ? "Deleting…" : "Delete report"}
              </EButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
