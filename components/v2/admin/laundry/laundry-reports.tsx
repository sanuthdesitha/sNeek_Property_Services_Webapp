"use client";

/**
 * ESTATE laundry Reports tab — v2-native rebuild of the v1 reports card. Shares
 * one scope/filter source so preview (GET), download (POST) and email (POST) all
 * compute the identical task set + total. Reuses the existing endpoints:
 *   GET  /api/laundry/invoice/preview      → { data, template }
 *   POST /api/laundry/invoice/download     → application/pdf
 *   POST /api/admin/laundry/reports/email  → { ok }
 *   GET  /api/admin/laundry/reports/history?limit= → audit entries
 * Filters mirror lib/laundry/report-filters (period/scope/statuses/dateField/
 * groupByProperty). Evidence renders through the shared MediaGallery overlay.
 */
import * as React from "react";
import { format } from "date-fns";
import { Download, FileText, History, Mail } from "lucide-react";
import { LaundryStatus } from "@prisma/client";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect } from "@/components/v2/admin/estate-kit";
import { MediaGallery, type MediaGalleryItem } from "@/components/shared/media-gallery";
import { statusLabel, statusTone } from "./laundry-shared";

type Period = "daily" | "weekly" | "monthly" | "annual" | "custom";
type Scope = "all" | "client" | "property";
type DateField = "scheduled" | "confirmed" | "pickup" | "dropped";

const STATUS_VALUES = Object.values(LaundryStatus) as string[];
const DATE_FIELDS: Array<{ value: DateField; label: string }> = [
  { value: "dropped", label: "Drop-off date" },
  { value: "scheduled", label: "Scheduled date" },
  { value: "confirmed", label: "Confirmed date" },
  { value: "pickup", label: "Pickup date" },
];

function dateInputValue(d: Date) {
  return format(d, "yyyy-MM-dd");
}

type ReportRow = {
  taskId: string;
  propertyName: string;
  suburb: string;
  status: string;
  serviceDate: string;
  pickupDate: string;
  dropoffDate: string;
  bagCount: number | null;
  amount: number;
  dropoffLocation: string | null;
  notes: string | null;
  earlyDropoffReason: string | null;
  cleanerPhotoUrl: string | null;
  pickupPhotoUrl: string | null;
  dropoffPhotoUrl: string | null;
};

type ReportData = {
  period: string;
  rows: ReportRow[];
  totalAmount: number;
  propertyBreakdown: Array<{ propertyId: string }>;
  dateFieldLabel?: string;
  statusLabel?: string;
};

type HistoryEntry = {
  id: string;
  action: string;
  createdAt: string;
  user?: { name: string | null; email: string | null } | null;
  details?: any;
};

export function LaundryReports() {
  const [period, setPeriod] = React.useState<Period>("weekly");
  const [anchorDate, setAnchorDate] = React.useState(() => dateInputValue(new Date()));
  const [startDate, setStartDate] = React.useState(() => dateInputValue(new Date()));
  const [endDate, setEndDate] = React.useState(() => dateInputValue(new Date()));
  const [scope, setScope] = React.useState<Scope>("all");
  const [clientId, setClientId] = React.useState("");
  const [propertyId, setPropertyId] = React.useState("");
  const [statuses, setStatuses] = React.useState<string[]>([]);
  const [dateField, setDateField] = React.useState<DateField>("dropped");
  const [groupByProperty, setGroupByProperty] = React.useState(false);
  const [email, setEmail] = React.useState("");

  const [clients, setClients] = React.useState<Array<{ id: string; name: string; email: string | null }>>([]);
  const [properties, setProperties] = React.useState<Array<{ id: string; name: string; suburb: string }>>([]);

  const [preview, setPreview] = React.useState<ReportData | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [emailing, setEmailing] = React.useState(false);

  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((body) => {
        const rows = Array.isArray(body) ? body : [];
        setClients(rows.filter((c: any) => c?.id).map((c: any) => ({ id: c.id, name: c.name || c.email || "Client", email: c.email ?? null })));
      })
      .catch(() => setClients([]));
    fetch("/api/admin/properties")
      .then((r) => r.json())
      .then((body) => {
        const rows = Array.isArray(body) ? body : [];
        setProperties(rows.filter((p: any) => p?.id).map((p: any) => ({ id: p.id, name: p.name || "Unnamed", suburb: p.suburb || "" })));
      })
      .catch(() => setProperties([]));
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Single source of truth for scope/filter fields (v1 parity). */
  function scopeFilters() {
    const filters: { clientId?: string; propertyIds?: string[]; statuses?: string[]; dateField?: string; groupByProperty?: boolean } = {};
    if (scope === "client" && clientId) filters.clientId = clientId;
    if (scope === "property" && propertyId) filters.propertyIds = [propertyId];
    if (statuses.length) filters.statuses = statuses;
    filters.dateField = dateField;
    if (groupByProperty) filters.groupByProperty = true;
    return filters;
  }

  function reportBody(extra?: Record<string, unknown>) {
    const filters = scopeFilters();
    const base =
      period === "custom"
        ? { period, startDate: startDate || undefined, endDate: endDate || undefined }
        : { period, anchorDate: anchorDate || undefined };
    return { ...base, includePending: true, ...filters, ...extra };
  }

  function buildQuery() {
    const params = new URLSearchParams();
    params.set("period", period);
    params.set("includePending", "true");
    if (period === "custom") {
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
    } else if (anchorDate) {
      params.set("anchorDate", anchorDate);
    }
    const filters = scopeFilters();
    if (filters.clientId) params.set("clientId", filters.clientId);
    if (filters.propertyIds?.length) params.set("propertyIds", filters.propertyIds.join(","));
    if (filters.statuses?.length) params.set("statuses", filters.statuses.join(","));
    if (filters.dateField) params.set("dateField", filters.dateField);
    if (filters.groupByProperty) params.set("groupByProperty", "true");
    return params.toString();
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/admin/laundry/reports/history?limit=20", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      setHistory(Array.isArray(body) ? body : []);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function runPreview() {
    setLoading(true);
    try {
      const res = await fetch(`/api/laundry/invoice/preview?${buildQuery()}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Preview failed", description: body.error ?? "Could not load report preview.", variant: "destructive" });
        return;
      }
      setPreview(body?.data ?? null);
      setPreviewOpen(true);
      void loadHistory();
    } finally {
      setLoading(false);
    }
  }

  async function runDownload() {
    setDownloading(true);
    try {
      const res = await fetch("/api/laundry/invoice/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reportBody()),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Download failed", description: body.error ?? "Could not generate PDF.", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `laundry-report-${period}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      void loadHistory();
    } finally {
      setDownloading(false);
    }
  }

  async function runEmail() {
    if (!email.trim()) {
      toast({ title: "Email required", description: "Enter the recipient email first.", variant: "destructive" });
      return;
    }
    setEmailing(true);
    try {
      const res = await fetch("/api/admin/laundry/reports/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reportBody({ to: email.trim() })),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Email failed", description: body.error ?? "Could not email report.", variant: "destructive" });
        return;
      }
      toast({ title: "Laundry report emailed", description: `Sent to ${email.trim()}.` });
      void loadHistory();
    } finally {
      setEmailing(false);
    }
  }

  function toggleStatus(value: string) {
    setStatuses((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));
  }

  return (
    <div className="space-y-4">
      <ECard>
        <ECardBody className="space-y-5 pt-6">
          <div className="flex items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 text-[1.0625rem] font-semibold tracking-[-0.01em]">
              <FileText className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Laundry reports
            </p>
            <EButton variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
              <History className="h-3.5 w-3.5" /> History
            </EButton>
          </div>

          {/* Period */}
          <div className="grid gap-3 sm:grid-cols-3">
            <EField label="Period">
              <ESelect value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
                <option value="custom">Custom range</option>
              </ESelect>
            </EField>
            {period === "custom" ? (
              <>
                <EField label="Start date">
                  <EInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </EField>
                <EField label="End date">
                  <EInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </EField>
              </>
            ) : (
              <EField label="Anchor date" hint="Any date inside the period.">
                <EInput type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
              </EField>
            )}
          </div>

          {/* Scope */}
          <div className="grid gap-3 sm:grid-cols-3">
            <EField label="Scope">
              <ESelect
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as Scope);
                  setClientId("");
                  setPropertyId("");
                }}
              >
                <option value="all">All properties</option>
                <option value="client">By client</option>
                <option value="property">By property</option>
              </ESelect>
            </EField>
            {scope === "client" ? (
              <EField label="Client" className="sm:col-span-2">
                <ESelect value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Select a client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </ESelect>
              </EField>
            ) : scope === "property" ? (
              <EField label="Property" className="sm:col-span-2">
                <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  <option value="">Select a property…</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.suburb ? ` — ${p.suburb}` : ""}
                    </option>
                  ))}
                </ESelect>
              </EField>
            ) : null}
          </div>

          {/* Date field + group by */}
          <div className="grid gap-3 sm:grid-cols-3">
            <EField label="Date basis" hint="Which timestamp the range applies to.">
              <ESelect value={dateField} onChange={(e) => setDateField(e.target.value as DateField)}>
                {DATE_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Grouping" className="sm:col-span-2">
              <label className="flex h-10 items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                <input
                  type="checkbox"
                  checked={groupByProperty}
                  onChange={(e) => setGroupByProperty(e.target.checked)}
                  className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                />
                Group job table by property with subtotals
              </label>
            </EField>
          </div>

          {/* Statuses */}
          <EField label="Statuses" hint="None selected = all statuses.">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_VALUES.map((s) => {
                const active = statuses.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStatus(s)}
                    className={
                      "rounded-[var(--e-radius-pill)] border px-2.5 py-1 text-[0.75rem] font-[550] transition-colors " +
                      (active
                        ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                        : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]")
                    }
                  >
                    {statusLabel(s)}
                  </button>
                );
              })}
            </div>
          </EField>

          {/* Email + actions */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <EField label="Email report to" hint="Sends the PDF as an attachment.">
              <EInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="recipient@example.com" />
            </EField>
            <div className="flex flex-wrap gap-2">
              <EButton variant="outline" size="md" onClick={() => void runPreview()} disabled={loading}>
                <FileText className="h-4 w-4" /> {loading ? "Loading…" : "Preview"}
              </EButton>
              <EButton variant="outline" size="md" onClick={() => void runDownload()} disabled={downloading}>
                <Download className="h-4 w-4" /> {downloading ? "Generating…" : "Download"}
              </EButton>
              <EButton variant="gold" size="md" onClick={() => void runEmail()} disabled={emailing}>
                <Mail className="h-4 w-4" /> {emailing ? "Sending…" : "Email"}
              </EButton>
            </div>
          </div>
        </ECardBody>
      </ECard>

      {/* Preview modal */}
      <EModal open={previewOpen} onClose={() => setPreviewOpen(false)} eyebrow="Report preview" title="Laundry report" size="full">
        {preview ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { label: "Period", value: preview.period },
                { label: "Jobs", value: String(preview.rows?.length ?? 0) },
                { label: "Properties", value: String(preview.propertyBreakdown?.length ?? 0) },
                { label: "Total", value: `$${Number(preview.totalAmount ?? 0).toFixed(2)}` },
              ].map((tile) => (
                <div key={tile.label} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                  <p className="e-eyebrow">{tile.label}</p>
                  <p className="e-numeral mt-1 text-[1.25rem] leading-none capitalize">{tile.value}</p>
                </div>
              ))}
            </div>

            {(preview.rows ?? []).length === 0 ? (
              <p className="py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                No jobs found for the selected filters.
              </p>
            ) : (
              <div className="space-y-3">
                {(preview.rows ?? []).map((row) => {
                  const media: MediaGalleryItem[] = [
                    row.cleanerPhotoUrl ? { id: `${row.taskId}-cleaner`, url: row.cleanerPhotoUrl, label: "Cleaner", mediaType: "PHOTO" } : null,
                    row.pickupPhotoUrl ? { id: `${row.taskId}-pickup`, url: row.pickupPhotoUrl, label: "Pickup", mediaType: "PHOTO" } : null,
                    row.dropoffPhotoUrl ? { id: `${row.taskId}-dropoff`, url: row.dropoffPhotoUrl, label: "Drop-off", mediaType: "PHOTO" } : null,
                  ].filter(Boolean) as MediaGalleryItem[];
                  return (
                    <div key={row.taskId} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3 text-[0.875rem]">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-[550]">{row.propertyName}</p>
                          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            {row.suburb} · Service {format(new Date(row.serviceDate), "d MMM yyyy")} · Pickup{" "}
                            {format(new Date(row.pickupDate), "d MMM")} · Return {format(new Date(row.dropoffDate), "d MMM")}
                          </p>
                        </div>
                        <EBadge tone={statusTone(row.status)} soft>
                          {statusLabel(row.status)}
                        </EBadge>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] p-2">
                          <p className="e-eyebrow">Bags / Amount</p>
                          <p className="e-tnum">{row.bagCount ?? "—"} bag(s) · ${Number(row.amount ?? 0).toFixed(2)}</p>
                        </div>
                        <div className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] p-2">
                          <p className="e-eyebrow">Drop-off location</p>
                          <p>{row.dropoffLocation || "—"}</p>
                        </div>
                        <div className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] p-2">
                          <p className="e-eyebrow">Notes</p>
                          <p>{row.notes || row.earlyDropoffReason || "—"}</p>
                        </div>
                      </div>
                      {media.length > 0 ? (
                        <div className="mt-3">
                          <p className="e-eyebrow mb-1.5">Evidence</p>
                          <MediaGallery items={media} title="Laundry report evidence" className="grid grid-cols-3 gap-2 sm:grid-cols-4" />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>
                Close
              </EButton>
              <EButton variant="outline" size="sm" onClick={() => void runDownload()} disabled={downloading}>
                <Download className="h-3.5 w-3.5" /> {downloading ? "Generating…" : "Download PDF"}
              </EButton>
              <EButton variant="gold" size="sm" onClick={() => void runEmail()} disabled={emailing}>
                <Mail className="h-3.5 w-3.5" /> {emailing ? "Sending…" : "Email PDF"}
              </EButton>
            </div>
          </div>
        ) : (
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No preview loaded.</p>
        )}
      </EModal>

      {/* History modal */}
      <EModal open={historyOpen} onClose={() => setHistoryOpen(false)} eyebrow="Audit trail" title="Report history" wide>
        {historyLoading ? (
          <p className="py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : history.length === 0 ? (
          <p className="py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No report activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((entry) => {
              const action = entry.action.replace("LAUNDRY_REPORT_", "");
              const tone = action === "EMAIL" ? "info" : action === "DOWNLOAD" ? "primary" : "neutral";
              const recipient = entry.details?.recipient as string | undefined;
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-2">
                      <EBadge tone={tone as any} soft>
                        {action}
                      </EBadge>
                      <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">
                        {entry.user?.name || entry.user?.email || "User"}
                      </span>
                    </span>
                    {recipient ? (
                      <span className="ml-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">→ {recipient}</span>
                    ) : null}
                  </div>
                  <span className="e-tnum text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    {format(new Date(entry.createdAt), "d MMM yyyy, HH:mm")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </EModal>
    </div>
  );
}
