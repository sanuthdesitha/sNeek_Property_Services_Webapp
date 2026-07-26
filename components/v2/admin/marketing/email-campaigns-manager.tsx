"use client";

import { useEffect, useMemo, useState } from "react";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EConfirmModal, EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import {
  defaultDesign,
  parseEmailHtml,
  renderEmailHtml,
  type EmailDesign,
} from "@/lib/templates/email-blocks";
import {
  EmailBlockEditor,
  EmailPreview,
  type BrandChrome,
  type PickableAsset,
} from "@/components/v2/admin/marketing/email-block-editor";

type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  audience: any;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number | null;
  createdAt: string;
  createdBy?: { name: string | null; email: string };
};

export type CampaignStatsRow = {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
  complaintRate: number;
};

type SegmentRow = { id: string; label: string; description: string; count: number };

type AudienceType = "all_clients" | "inactive_clients" | "service_type" | "segment";

type FormState = {
  name: string;
  subject: string;
  htmlBody: string;
  audienceType: AudienceType;
  segmentId: string;
  inactiveDays: string;
  jobTypes: string[];
  status: "draft" | "scheduled";
  scheduledAt: string;
};

type Toast = { title: string; description?: string; tone: "success" | "danger" };

const EMPTY_FORM: FormState = {
  name: "",
  subject: "",
  htmlBody: "",
  audienceType: "all_clients",
  segmentId: "all_active_clients",
  inactiveDays: "60",
  jobTypes: [],
  status: "draft",
  scheduledAt: "",
};

function toInputDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formFromCampaign(row: CampaignRow): FormState {
  const audience = row.audience && typeof row.audience === "object" ? row.audience : {};
  const filters = audience.filters && typeof audience.filters === "object" ? audience.filters : {};
  const audienceType: AudienceType =
    audience.type === "inactive_clients" || audience.type === "service_type" || audience.type === "segment"
      ? audience.type
      : "all_clients";
  return {
    name: row.name,
    subject: row.subject,
    htmlBody: row.htmlBody,
    audienceType,
    segmentId: typeof filters.segmentId === "string" ? filters.segmentId : "all_active_clients",
    inactiveDays: filters.daysSinceLastBooking ? String(filters.daysSinceLastBooking) : "60",
    jobTypes: Array.isArray(filters.jobTypes) ? filters.jobTypes : [],
    status: row.status === "scheduled" ? "scheduled" : "draft",
    scheduledAt: toInputDateTime(row.scheduledAt),
  };
}

function statusTone(status: string): "neutral" | "warning" | "success" | "info" {
  if (status === "sent") return "success";
  if (status === "scheduled") return "warning";
  if (status === "sending") return "info";
  return "neutral";
}

function pct(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function StatsStrip({ stats }: { stats: CampaignStatsRow }) {
  const cells: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Sent", value: String(stats.sent) },
    { label: "Delivered", value: String(stats.delivered), sub: pct(stats.deliveryRate) },
    { label: "Opened", value: String(stats.opened), sub: pct(stats.openRate) },
    { label: "Clicked", value: String(stats.clicked), sub: pct(stats.clickRate) },
    { label: "Bounced", value: String(stats.bounced), sub: pct(stats.bounceRate) },
    { label: "Complaints", value: String(stats.complained), sub: pct(stats.complaintRate) },
  ];
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2 sm:grid-cols-6">
      {cells.map((cell) => (
        <div key={cell.label}>
          <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{cell.label}</p>
          <p className="text-[0.9375rem] font-semibold text-[hsl(var(--e-foreground))]">
            {cell.value}
            {cell.sub ? <span className="ml-1 text-[0.75rem] font-normal text-[hsl(var(--e-muted-foreground))]">{cell.sub}</span> : null}
          </p>
        </div>
      ))}
    </div>
  );
}

export function EmailCampaignsManager({
  initialCampaigns,
  onToast,
  assets = [],
  brand,
  stats = {},
  externalDraft = null,
  onExternalDraftConsumed,
}: {
  initialCampaigns: CampaignRow[];
  onToast: (t: Toast) => void;
  assets?: PickableAsset[];
  brand: BrandChrome;
  stats?: Record<string, CampaignStatsRow>;
  /** A draft handed over from the template gallery — opened for editing on arrival. */
  externalDraft?: CampaignRow | null;
  onExternalDraftConsumed?: () => void;
}) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [design, setDesign] = useState<EmailDesign>(() => defaultDesign());
  const [mode, setMode] = useState<"blocks" | "html">("blocks");
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(false);

  // Live audience sizes for the picker — resolved server-side so the count shown
  // is exactly what the sender would produce.
  useEffect(() => {
    let cancelled = false;
    setSegmentsLoading(true);
    fetch("/api/admin/marketing/segments")
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled && Array.isArray(body?.segments)) setSegments(body.segments);
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setSegmentsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function loadCampaign(row: CampaignRow) {
    setEditingId(row.id);
    setForm(formFromCampaign(row));
    setDesign(parseEmailHtml(row.htmlBody));
    setMode("blocks");
  }

  // Template gallery handoff: prepend the new draft and open it.
  useEffect(() => {
    if (!externalDraft) return;
    setCampaigns((cur) => (cur.some((c) => c.id === externalDraft.id) ? cur : [externalDraft, ...cur]));
    loadCampaign(externalDraft);
    onExternalDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalDraft?.id]);

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDesign(defaultDesign());
    setMode("blocks");
  }

  const selectedSegment = useMemo(
    () => segments.find((s) => s.id === form.segmentId) ?? null,
    [segments, form.segmentId],
  );

  /** In blocks mode the design IS the source of truth; HTML mode edits raw. */
  function currentHtml(): string {
    return mode === "blocks" ? renderEmailHtml(design) : form.htmlBody;
  }

  function buildPayload() {
    return {
      name: form.name,
      subject: form.subject,
      htmlBody: currentHtml(),
      audience: {
        type: form.audienceType,
        filters:
          form.audienceType === "segment"
            ? { segmentId: form.segmentId }
            : form.audienceType === "inactive_clients"
              ? { daysSinceLastBooking: Number(form.inactiveDays || 60) }
              : form.audienceType === "service_type"
                ? { jobTypes: form.jobTypes }
                : {},
      },
      status: form.status,
      scheduledAt: form.status === "scheduled" && form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
    };
  }

  async function saveCampaign() {
    setSaving(true);
    try {
      const response = await fetch(editingId ? `/api/admin/email-campaigns/${editingId}` : "/api/admin/email-campaigns", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not save campaign.");
      const campaign = body.campaign as CampaignRow;
      setCampaigns((cur) => {
        const next = editingId ? cur.map((i) => (i.id === campaign.id ? campaign : i)) : [campaign, ...cur];
        return [...next].sort((l, r) => new Date(r.createdAt).getTime() - new Date(l.createdAt).getTime());
      });
      onToast({ title: editingId ? "Campaign updated" : "Campaign created", tone: "success" });
      resetForm();
    } catch (error: any) {
      onToast({ title: "Save failed", description: error?.message ?? "Could not save campaign.", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  async function sendCampaign(id: string) {
    setSendingId(id);
    try {
      const response = await fetch(`/api/admin/email-campaigns/${id}/send`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not send campaign.");
      setCampaigns((cur) =>
        cur.map((i) => (i.id === id ? { ...i, status: "sent", sentAt: new Date().toISOString(), recipientCount: body.sent ?? i.recipientCount } : i))
      );
      onToast({
        title: "Campaign sent",
        description: `${body.sent ?? 0} sent${body.suppressed ? `, ${body.suppressed} skipped (suppressed)` : ""}.`,
        tone: "success",
      });
    } catch (error: any) {
      onToast({ title: "Send failed", description: error?.message ?? "Could not send campaign.", tone: "danger" });
    } finally {
      setSendingId(null);
    }
  }

  async function sendTest(id: string) {
    setTestingId(id);
    try {
      const response = await fetch(`/api/admin/email-campaigns/${id}/test-send`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not send the test.");
      onToast({ title: "Test sent", description: `Check ${body.to}.`, tone: "success" });
    } catch (error: any) {
      onToast({ title: "Test send failed", description: error?.message, tone: "danger" });
    } finally {
      setTestingId(null);
    }
  }

  async function deleteCampaign() {
    if (!confirmId) return;
    setConfirmLoading(true);
    try {
      const response = await fetch(`/api/admin/email-campaigns/${confirmId}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not delete campaign.");
      setCampaigns((cur) => cur.filter((i) => i.id !== confirmId));
      if (editingId === confirmId) resetForm();
      onToast({ title: "Campaign deleted", tone: "success" });
      setConfirmId(null);
    } catch (error: any) {
      onToast({ title: "Delete failed", description: error?.message ?? "Could not delete campaign.", tone: "danger" });
    } finally {
      setConfirmLoading(false);
    }
  }

  const previewDesign = mode === "blocks" ? design : parseEmailHtml(form.htmlBody);
  const canSave = Boolean(form.name.trim() && form.subject.trim() && currentHtml().trim());

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-6">
        <ECard>
          <ECardHeader className="pb-3">
            <ECardTitle className="text-[0.95rem]">{editingId ? "Edit email campaign" : "New email campaign"}</ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Compose with blocks, pick an audience, then send now or schedule it.</p>
          </ECardHeader>
          <ECardBody className="space-y-4 pt-0">
            <EField label="Name"><EInput value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="Campaign name" /></EField>
            <EField label="Subject"><EInput value={form.subject} onChange={(e) => setForm((c) => ({ ...c, subject: e.target.value }))} placeholder="Subject line" /></EField>

            <EField label="Audience">
              <ESelect value={form.audienceType} onChange={(e) => setForm((c) => ({ ...c, audienceType: e.target.value as AudienceType }))}>
                <option value="segment">Named segment</option>
                <option value="all_clients">All active clients</option>
                <option value="inactive_clients">Inactive clients</option>
                <option value="service_type">Clients by service type</option>
              </ESelect>
            </EField>

            {form.audienceType === "segment" ? (
              <div className="space-y-2">
                <EField label="Segment">
                  <ESelect value={form.segmentId} onChange={(e) => setForm((c) => ({ ...c, segmentId: e.target.value }))}>
                    {segments.length === 0 ? <option value={form.segmentId}>{segmentsLoading ? "Loading…" : form.segmentId}</option> : null}
                    {segments.map((segment) => (
                      <option key={segment.id} value={segment.id}>{segment.label} — {segment.count} recipient{segment.count === 1 ? "" : "s"}</option>
                    ))}
                  </ESelect>
                </EField>
                {selectedSegment ? (
                  <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {selectedSegment.description}
                    <span className="ml-1 font-[550] text-[hsl(var(--e-foreground))]">
                      Resolves to {selectedSegment.count} recipient{selectedSegment.count === 1 ? "" : "s"} right now.
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}

            {form.audienceType === "inactive_clients" ? (
              <EField label="No booking for at least X days">
                <EInput type="number" min="1" step="1" value={form.inactiveDays} onChange={(e) => setForm((c) => ({ ...c, inactiveDays: e.target.value }))} />
              </EField>
            ) : null}
            {form.audienceType === "service_type" ? (
              <div className="space-y-2">
                <label className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Service types</label>
                <div className="grid gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 md:grid-cols-2">
                  {MARKETED_SERVICES.map((service) => {
                    const checked = form.jobTypes.includes(service.jobType);
                    return (
                      <label key={service.jobType} className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-foreground))]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setForm((c) => ({ ...c, jobTypes: e.target.checked ? [...c.jobTypes, service.jobType] : c.jobTypes.filter((i) => i !== service.jobType) }))}
                          className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                        />
                        <span>{service.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <EField label="Status">
                <ESelect value={form.status} onChange={(e) => setForm((c) => ({ ...c, status: e.target.value as FormState["status"] }))}>
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                </ESelect>
              </EField>
              <EField label="Schedule at (Sydney)">
                <EInput type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm((c) => ({ ...c, scheduledAt: e.target.value }))} disabled={form.status !== "scheduled"} />
              </EField>
            </div>
            {form.status === "scheduled" ? (
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Scheduled campaigns are picked up by the <code>email-campaign-dispatch</code> job, which ticks every 5 minutes and claims each campaign atomically so it can never be sent twice.
              </p>
            ) : null}

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { setDesign(parseEmailHtml(form.htmlBody || renderEmailHtml(design))); setMode("blocks"); }}
                className={`rounded-[var(--e-radius)] px-2.5 py-1 text-[0.8125rem] font-[550] ${mode === "blocks" ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))]"}`}
              >
                Blocks
              </button>
              <button
                type="button"
                onClick={() => { setForm((c) => ({ ...c, htmlBody: renderEmailHtml(design) })); setMode("html"); }}
                className={`rounded-[var(--e-radius)] px-2.5 py-1 text-[0.8125rem] font-[550] ${mode === "html" ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))]"}`}
              >
                Raw HTML
              </button>
            </div>

            {mode === "blocks" ? (
              <EmailBlockEditor design={design} onChange={setDesign} assets={assets} brand={brand} />
            ) : (
              <EField label="HTML body">
                <ETextarea
                  rows={16}
                  value={form.htmlBody}
                  onChange={(e) => setForm((c) => ({ ...c, htmlBody: e.target.value }))}
                  placeholder="<p>Hello from sNeek…</p>"
                  className="font-mono text-[0.8125rem]"
                />
              </EField>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <EButton type="button" variant="outline" onClick={resetForm}>Reset</EButton>
              <EButton type="button" onClick={saveCampaign} disabled={saving || !canSave}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Create campaign"}
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      </div>

      <div className="space-y-6">
        <EmailPreview design={previewDesign} brand={brand} height={520} />

        <ECard>
          <ECardHeader className="pb-3">
            <ECardTitle className="text-[0.95rem]">Campaigns</ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Draft, scheduled, and sent client email campaigns.</p>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            {campaigns.length === 0 ? (
              <EEmptyState eyebrow="Email" title="No email campaigns yet" description="Start from the Templates tab, or build one from blocks." />
            ) : (
              campaigns.map((campaign) => {
                const stat = stats[campaign.id];
                return (
                  <div key={campaign.id} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[0.9375rem] font-semibold text-[hsl(var(--e-foreground))]">{campaign.name}</p>
                          <EBadge tone={statusTone(campaign.status)} soft>{campaign.status.replace(/_/g, " ")}</EBadge>
                        </div>
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{campaign.subject}</p>
                        <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                          {campaign.scheduledAt ? `Scheduled ${new Date(campaign.scheduledAt).toLocaleString("en-AU")}` : ""}
                          {campaign.sentAt ? `Sent ${new Date(campaign.sentAt).toLocaleString("en-AU")}` : ""}
                          {` · Recipients processed: ${campaign.recipientCount ?? 0}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <EButton variant="outline" size="sm" onClick={() => loadCampaign(campaign)}>Edit</EButton>
                        <EButton variant="outline" size="sm" onClick={() => sendTest(campaign.id)} disabled={testingId === campaign.id}>
                          {testingId === campaign.id ? "Sending…" : "Send test to me"}
                        </EButton>
                        <EButton size="sm" onClick={() => sendCampaign(campaign.id)} disabled={sendingId === campaign.id}>{sendingId === campaign.id ? "Sending…" : "Send now"}</EButton>
                        <EButton variant="danger" size="sm" onClick={() => setConfirmId(campaign.id)}>Delete</EButton>
                      </div>
                    </div>
                    {stat && (stat.sent > 0 || stat.delivered > 0 || stat.opened > 0) ? <StatsStrip stats={stat} /> : null}
                  </div>
                );
              })
            )}
          </ECardBody>
        </ECard>
      </div>

      <EConfirmModal
        open={Boolean(confirmId)}
        onClose={() => setConfirmId(null)}
        title="Delete email campaign"
        description="This will remove the saved campaign from the marketing workspace."
        confirmLabel="Delete campaign"
        loading={confirmLoading}
        onConfirm={deleteCampaign}
      />
    </div>
  );
}
