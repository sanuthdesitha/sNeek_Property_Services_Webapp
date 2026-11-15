"use client";

/**
 * Email campaign editor (board "Marketing", 2026-11-16): three columns in
 * order — who gets it, what it says, when it goes — so the audience count, the
 * skipped addresses and the send time are visible together BEFORE anything is
 * scheduled or sent.
 *
 * Sending: email only (owner default, pending owner confirmation: no SMS
 * campaigns). Each person gets an individual message through the existing
 * campaign sender, which renders through the email design system with the
 * one-click unsubscribe and passes the sending safeguards; nothing here sends
 * directly. Scheduling or sending now is a tier A confirmation that names the
 * audience and the count (today's rule; campaign sending is not a tier C action).
 */
import * as React from "react";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { defaultDesign, parseEmailHtml, renderEmailHtml, type EmailDesign } from "@/lib/templates/email-blocks";
import { formatOrgDateTime, isoToZonedInput, zonedInputToIso } from "@/lib/public-site/zoned-time";
import type { EmailCampaignRow, SegmentOption } from "@/lib/marketing/workspace-types";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import { SingleCampaignRecipient, normalizedRecipientEmail, validRecipientEmail } from "@/components/admin/single-campaign-recipient";
import { EmailBlockEditor, EmailPreview, type BrandChrome, type PickableAsset } from "@/components/v2/admin/marketing/email-block-editor";

export type AudienceKind = "segment" | "all_clients" | "inactive_clients" | "service_type" | "single_recipient";

export type CampaignAudienceForm = {
  kind: AudienceKind;
  segmentId: string;
  inactiveDays: string;
  jobTypes: string[];
  email: string;
};

export type WhenChoice = "draft" | "schedule" | "now";

export type CampaignReachView = {
  withEmail: number;
  willSend: number;
  unsubscribed: number;
  bounceList: number;
  noEmail: number;
};

type ReachState = { status: "loading" } | { status: "error" } | { status: "ready"; reach: CampaignReachView } | { status: "invalid"; message: string };

export type SegmentsState = { status: "loading" } | { status: "error" } | { status: "ready"; segments: SegmentOption[] };

/** Board wording for the named audiences. */
const SEGMENT_LABEL: Record<string, string> = {
  all_active_clients: "All active clients",
  clients_with_job_last_90d: "Serviced in the last 90 days",
  dormant_90d: "Dormant 90+ days",
  airbnb_property_clients: "Airbnb and short-stay hosts",
  clients_with_active_recurring: "Recurring-schedule clients",
  leads_only: "Leads, quoted but never booked",
};

const SEGMENT_ORDER = Object.keys(SEGMENT_LABEL);

export function audienceFormFrom(audience: unknown): CampaignAudienceForm {
  const value = audience && typeof audience === "object" ? (audience as { type?: unknown; filters?: Record<string, unknown> }) : {};
  const filters = value.filters && typeof value.filters === "object" ? value.filters : {};
  const kind: AudienceKind =
    value.type === "segment" || value.type === "inactive_clients" || value.type === "service_type" || value.type === "single_recipient" || value.type === "all_clients"
      ? value.type
      : value.type === undefined
        ? "segment"
        : "all_clients";
  return {
    kind,
    segmentId: typeof filters.segmentId === "string" ? filters.segmentId : "all_active_clients",
    inactiveDays: typeof filters.daysSinceLastBooking === "number" ? String(filters.daysSinceLastBooking) : "60",
    jobTypes: Array.isArray(filters.jobTypes) ? filters.jobTypes.filter((item): item is string => typeof item === "string") : [],
    email: typeof filters.email === "string" ? filters.email : "",
  };
}

/** The audience JSON the API validates; null when it is incomplete. */
export function audiencePayload(form: CampaignAudienceForm): { type: AudienceKind; filters: Record<string, unknown> } | null {
  if (form.kind === "segment") return { type: "segment", filters: { segmentId: form.segmentId } };
  if (form.kind === "single_recipient") return validRecipientEmail(form.email) ? { type: "single_recipient", filters: { email: normalizedRecipientEmail(form.email) } } : null;
  if (form.kind === "inactive_clients") {
    const days = Math.round(Number(form.inactiveDays));
    return Number.isFinite(days) && days >= 1 ? { type: "inactive_clients", filters: { daysSinceLastBooking: days } } : null;
  }
  if (form.kind === "service_type") return form.jobTypes.length ? { type: "service_type", filters: { jobTypes: form.jobTypes } } : null;
  return { type: "all_clients", filters: {} };
}

export function audienceLabel(form: CampaignAudienceForm): string {
  if (form.kind === "segment") return SEGMENT_LABEL[form.segmentId] ?? form.segmentId;
  if (form.kind === "single_recipient") return normalizedRecipientEmail(form.email) || "one person";
  if (form.kind === "inactive_clients") return `Clients with no booking for ${form.inactiveDays || "60"}+ days`;
  if (form.kind === "service_type") return "Clients by service type";
  return "All active clients";
}

function hasBlockDesign(html: string) {
  return !html.trim() || html.includes("SNEEK_EMAIL_DESIGN");
}

function addMinutes(input: string, minutes: number): string {
  const [hours, mins] = input.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return "";
  const total = (hours! * 60 + mins! + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function StepTitle({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-[0.875rem] font-[600]">
      <span aria-hidden className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[hsl(var(--e-gold))] text-[0.6875rem] text-[hsl(var(--e-gold-foreground))]">
        {step}
      </span>
      {children}
    </h3>
  );
}

function OptionRow({
  name,
  checked,
  onSelect,
  label,
  count,
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: React.ReactNode;
  count?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-[var(--e-radius)] border px-2.5 py-2 text-[0.8125rem] ${
        checked ? "border-[hsl(var(--e-primary)/0.45)] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))]"
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]" />
      <span className="min-w-0 flex-1">
        <span className={checked ? "font-[600]" : undefined}>{label}</span>
        {children}
      </span>
      {count !== undefined ? <span className="ml-auto shrink-0 font-[600] tabular-nums">{count}</span> : null}
    </label>
  );
}

export function CampaignEditor({
  campaign,
  segments,
  assets,
  brand,
  timeZone,
  onSaved,
  onSent,
  onDeleted,
  onOpenTemplates,
}: {
  /** null: a new campaign. */
  campaign: EmailCampaignRow | null;
  segments: SegmentsState;
  assets: PickableAsset[];
  brand: BrandChrome;
  timeZone: string;
  onSaved: (row: EmailCampaignRow, message: string) => void;
  onSent: (row: EmailCampaignRow, result: { sent: number; failed: number; suppressed: number }) => void;
  onDeleted: (id: string) => void;
  onOpenTemplates: () => void;
}) {
  const initialHtml = campaign?.htmlBody ?? "";
  const [name, setName] = React.useState(campaign?.name ?? "");
  const [subject, setSubject] = React.useState(campaign?.subject ?? "");
  const [audience, setAudience] = React.useState<CampaignAudienceForm>(() => audienceFormFrom(campaign ? campaign.audience : undefined));
  const [mode, setMode] = React.useState<"blocks" | "html">(hasBlockDesign(initialHtml) ? "blocks" : "html");
  const [design, setDesign] = React.useState<EmailDesign>(() => (initialHtml ? parseEmailHtml(initialHtml) : defaultDesign()));
  const [html, setHtml] = React.useState(initialHtml);
  const scheduledInput = isoToZonedInput(campaign?.scheduledAt ?? null, timeZone);
  const [when, setWhen] = React.useState<WhenChoice>(campaign?.status === "scheduled" ? "schedule" : "draft");
  const [date, setDate] = React.useState(scheduledInput.slice(0, 10));
  const [time, setTime] = React.useState(scheduledInput.slice(11, 16) || "09:00");
  const [reach, setReach] = React.useState<ReachState>({ status: "loading" });
  const [reachRetry, setReachRetry] = React.useState(0);
  const [busy, setBusy] = React.useState<"save" | "send" | "test" | "delete" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<"schedule" | "now" | "delete" | null>(null);
  const [savedSnapshot, setSavedSnapshot] = React.useState<string | null>(null);

  const editable = !campaign || campaign.status === "draft" || campaign.status === "scheduled" || campaign.status === "failed";
  const payloadAudience = audiencePayload(audience);
  const audienceKey = JSON.stringify(payloadAudience);
  const currentHtml = mode === "blocks" ? renderEmailHtml(design) : html;
  const scheduleIso = zonedInputToIso(`${date}T${time}`, timeZone);
  const scheduleInFuture = scheduleIso !== null && new Date(scheduleIso).getTime() > Date.now();
  const scheduleLabel = scheduleIso ? formatOrgDateTime(scheduleIso, timeZone) : "";
  const snapshot = JSON.stringify({ name, subject, audienceKey, currentHtml, when, scheduleIso });
  const baseline = React.useRef(snapshot);
  const dirty = snapshot !== (savedSnapshot ?? baseline.current);

  // Count the audience and the skipped addresses; obsolete reads are cancelled.
  React.useEffect(() => {
    if (!payloadAudience) {
      setReach({ status: "invalid", message: audience.kind === "single_recipient" ? "Enter one email address to count." : audience.kind === "service_type" ? "Choose at least one service." : "Enter a number of days." });
      return;
    }
    const controller = new AbortController();
    setReach({ status: "loading" });
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/email-campaigns/reach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audience: payloadAudience }),
          signal: controller.signal,
        });
        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !body?.reach || typeof body.reach.willSend !== "number") {
          setReach({ status: "error" });
          return;
        }
        setReach({ status: "ready", reach: body.reach as CampaignReachView });
      } catch {
        if (!controller.signal.aborted) setReach({ status: "error" });
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // audienceKey captures the audience payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey, reachRetry]);

  const willSend = reach.status === "ready" ? reach.reach.willSend : null;
  const skipped = reach.status === "ready" ? reach.reach.unsubscribed + reach.reach.bounceList + reach.reach.noEmail : null;
  const contentReady = Boolean(name.trim() && subject.trim() && currentHtml.trim() && payloadAudience);

  function body(status: "draft" | "scheduled") {
    return {
      name: name.trim(),
      subject: subject.trim(),
      htmlBody: currentHtml,
      audience: payloadAudience,
      status,
      scheduledAt: status === "scheduled" ? scheduleIso : null,
    };
  }

  async function persist(status: "draft" | "scheduled"): Promise<EmailCampaignRow | null> {
    const res = await fetch(campaign ? `/api/admin/email-campaigns/${campaign.id}` : "/api/admin/email-campaigns", {
      method: campaign ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body(status)),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.campaign) throw new Error(json?.error ?? "The campaign was not saved.");
    const saved = json.campaign as Record<string, unknown>;
    return {
      ...(campaign ?? { sends: { sent: 0, failed: 0, skipped: 0 }, report: null }),
      id: String(saved.id),
      name: String(saved.name),
      subject: String(saved.subject),
      htmlBody: String(saved.htmlBody),
      audience: saved.audience,
      status: String(saved.status),
      scheduledAt: (saved.scheduledAt as string | null) ?? null,
      sentAt: (saved.sentAt as string | null) ?? null,
      recipientCount: (saved.recipientCount as number | null) ?? null,
      createdAt: String(saved.createdAt ?? new Date().toISOString()),
      updatedAt: String(saved.updatedAt ?? new Date().toISOString()),
    } as EmailCampaignRow;
  }

  async function save(status: "draft" | "scheduled") {
    if (busy || !contentReady) return;
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const row = await persist(status);
      if (!row) return;
      setSavedSnapshot(snapshot);
      setConfirm(null);
      onSaved(row, status === "scheduled" ? `Scheduled for ${scheduleLabel}. Scheduled is not sent.` : "Draft saved. Nothing was sent.");
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "The campaign was not saved."} Everything you entered is kept.`);
    } finally {
      setBusy(null);
    }
  }

  async function sendNow() {
    if (busy || !contentReady) return;
    setBusy("send");
    setError(null);
    try {
      const row = await persist("draft");
      if (!row) return;
      setSavedSnapshot(snapshot);
      const res = await fetch(`/api/admin/email-campaigns/${row.id}/send`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "The campaign was not sent.");
      setConfirm(null);
      onSent(row, { sent: Number(json.sent ?? 0), failed: Number(json.failed ?? 0), suppressed: Number(json.suppressed ?? 0) });
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "The campaign was not sent."} Check the list for what was recorded before trying again.`);
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    if (!campaign || busy) return;
    setBusy("test");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/email-campaigns/${campaign.id}/test-send`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "The test was not sent.");
      setNotice(`Test handed to the email service for ${json.to ?? "your address"}. Handed over is not delivered; check your inbox.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The test was not sent.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!campaign || busy) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/admin/email-campaigns/${campaign.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "The campaign was not deleted.");
      setConfirm(null);
      onDeleted(campaign.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The campaign was not deleted.");
    } finally {
      setBusy(null);
    }
  }

  const segmentOptions =
    segments.status === "ready"
      ? SEGMENT_ORDER.map((id) => segments.segments.find((segment) => segment.id === id)).filter((item): item is SegmentOption => Boolean(item))
      : SEGMENT_ORDER.map((id) => ({ id, label: SEGMENT_LABEL[id]!, description: "", count: -1 }));
  const countCell = (option: SegmentOption) => (segments.status === "ready" ? option.count.toLocaleString("en-AU") : segments.status === "loading" ? "–" : "?");

  const primaryLabel =
    when === "draft" ? (busy === "save" ? "Saving…" : "Save draft") : when === "schedule" ? (scheduleLabel ? `Schedule for ${scheduleLabel}` : "Schedule") : busy === "send" ? "Sending…" : willSend !== null ? `Send now to ${willSend.toLocaleString("en-AU")}` : "Send now";
  const primaryDisabled =
    Boolean(busy) ||
    !editable ||
    !contentReady ||
    (when !== "draft" && (reach.status !== "ready" || (willSend ?? 0) === 0)) ||
    (when === "schedule" && !scheduleInFuture);
  const whyDisabled = !editable
    ? "A sent campaign cannot be changed. Make a new one from a template or copy its wording."
    : !contentReady
      ? "Add a name, a subject, the email wording and a complete audience."
      : when !== "draft" && reach.status === "error"
        ? "Count not available: scheduling waits until the count loads."
        : when !== "draft" && reach.status === "loading"
          ? "Counting the audience…"
          : when !== "draft" && willSend === 0
            ? "Nobody in this audience can be sent to."
            : when === "schedule" && !scheduleInFuture
              ? "Choose a date and time in the future."
              : null;

  const audienceName = audienceLabel(audience);
  const skippedLine = skipped ? ` ${skipped.toLocaleString("en-AU")} address${skipped === 1 ? " is" : "es are"} skipped (unsubscribed, bounce list or no email).` : "";

  return (
    <div className="space-y-3">
      {error ? <p role="alert" className={`rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass("problem")}`}>{error}</p> : null}
      {notice ? <p role="status" className={`rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass("good")}`}>{notice}</p> : null}
      {!editable ? (
        <p role="status" className={`rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass("info")}`}>
          This campaign was {campaign?.status === "sending" ? "being sent" : "sent"}. It is shown read only.
        </p>
      ) : null}
      <fieldset disabled={Boolean(busy) || !editable} className="grid min-w-0 grid-cols-1 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-0 xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)_minmax(0,310px)]">
        <legend className="sr-only">Email campaign</legend>

        <section aria-label="Who gets it" className="min-w-0 space-y-2 p-4">
          <StepTitle step={1}>Who gets it</StepTitle>
          {segmentOptions.map((option) => (
            <OptionRow
              key={option.id}
              name="campaign-audience"
              checked={audience.kind === "segment" && audience.segmentId === option.id}
              onSelect={() => setAudience((current) => ({ ...current, kind: "segment", segmentId: option.id }))}
              label={SEGMENT_LABEL[option.id] ?? option.label}
              count={countCell(option)}
            />
          ))}
          {segments.status === "error" ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Counts not available. The audiences still work; the count below is checked on its own.</p> : null}
          <details open={audience.kind !== "segment" || undefined} className="text-[0.8125rem]">
            <summary className="min-h-11 cursor-pointer py-2 text-[hsl(var(--e-muted-foreground))]">Also: clients by service type, inactive for at least X days, or one person</summary>
            <div className="space-y-2 pt-1">
              {audience.kind === "all_clients" ? (
                <OptionRow name="campaign-audience" checked onSelect={() => undefined} label="All active clients (earlier rule)" />
              ) : null}
              <OptionRow name="campaign-audience" checked={audience.kind === "service_type"} onSelect={() => setAudience((current) => ({ ...current, kind: "service_type" }))} label="Clients by service type">
                {audience.kind === "service_type" ? (
                  <span className="mt-2 grid gap-1.5">
                    {MARKETED_SERVICES.map((service) => (
                      <label key={service.jobType} className="flex min-h-9 items-center gap-2 text-[0.8125rem]">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                          checked={audience.jobTypes.includes(service.jobType)}
                          onChange={(e) =>
                            setAudience((current) => ({
                              ...current,
                              jobTypes: e.target.checked ? [...current.jobTypes, service.jobType] : current.jobTypes.filter((item) => item !== service.jobType),
                            }))
                          }
                        />
                        {service.label}
                      </label>
                    ))}
                  </span>
                ) : null}
              </OptionRow>
              <OptionRow name="campaign-audience" checked={audience.kind === "inactive_clients"} onSelect={() => setAudience((current) => ({ ...current, kind: "inactive_clients" }))} label="No booking for at least X days">
                {audience.kind === "inactive_clients" ? (
                  <span className="mt-2 block">
                    <EInput aria-label="Days without a booking" type="number" min={1} step={1} value={audience.inactiveDays} onChange={(e) => setAudience((current) => ({ ...current, inactiveDays: e.target.value }))} className="max-w-[120px] max-sm:text-[1rem]" />
                  </span>
                ) : null}
              </OptionRow>
              <OptionRow name="campaign-audience" checked={audience.kind === "single_recipient"} onSelect={() => setAudience((current) => ({ ...current, kind: "single_recipient" }))} label="One person">
                {audience.kind === "single_recipient" ? (
                  <span className="mt-2 block">
                    <SingleCampaignRecipient email={audience.email} onChange={(email) => setAudience((current) => ({ ...current, email }))} />
                  </span>
                ) : null}
              </OptionRow>
            </div>
          </details>
          <div className="border-t border-[hsl(var(--e-border))] pt-2" aria-live="polite">
            {reach.status === "ready" ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[0.8125rem]">
                <dt>Will be sent</dt>
                <dd className="text-right font-[600] tabular-nums">{reach.reach.willSend.toLocaleString("en-AU")}</dd>
                <dt className="text-[hsl(var(--e-muted-foreground))]">Unsubscribed, skipped</dt>
                <dd className="text-right tabular-nums text-[hsl(var(--e-muted-foreground))]">{reach.reach.unsubscribed}</dd>
                <dt className="text-[hsl(var(--e-muted-foreground))]">On bounce list, skipped</dt>
                <dd className="text-right tabular-nums text-[hsl(var(--e-muted-foreground))]">{reach.reach.bounceList}</dd>
                <dt className="text-[hsl(var(--e-muted-foreground))]">No email address, skipped</dt>
                <dd className="text-right tabular-nums text-[hsl(var(--e-muted-foreground))]">{reach.reach.noEmail}</dd>
              </dl>
            ) : reach.status === "loading" ? (
              <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Counting who will be sent…</p>
            ) : reach.status === "invalid" ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{reach.message}</p>
            ) : (
              <div role="alert" className="space-y-1.5 text-[0.8125rem]">
                <p>Count not available. Scheduling waits until it loads.</p>
                <EButton variant="outline" size="sm" onClick={() => setReachRetry((value) => value + 1)}>Count again</EButton>
              </div>
            )}
          </div>
        </section>

        <section aria-label="What it says" className="min-w-0 space-y-3 border-t border-[hsl(var(--e-border))] p-4 xl:border-l xl:border-t-0">
          <StepTitle step={2}>What it says</StepTitle>
          <EField label="Name, only you see it">
            <EInput value={name} onChange={(e) => setName(e.target.value)} placeholder="December turnover dates" className="max-sm:text-[1rem]" />
          </EField>
          <EField label="Subject">
            <EInput value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Lock in your Christmas turnovers, {{firstName}}" className="max-sm:text-[1rem]" />
          </EField>
          {mode === "blocks" ? (
            <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2.5">
              <EmailBlockEditor design={design} onChange={setDesign} assets={assets} brand={brand} />
              <p className="rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Footer: {brand.companyName} · the one-click unsubscribe link is added automatically to every campaign email.
              </p>
              <EButton variant="outline" size="sm" onClick={onOpenTemplates}>From template…</EButton>
            </div>
          ) : (
            <EField label="Email wording (HTML, an earlier campaign written that way)">
              <ETextarea rows={12} value={html} onChange={(e) => setHtml(e.target.value)} className="font-mono text-[0.75rem]" />
            </EField>
          )}
          <details className="text-[0.8125rem]">
            <summary className="min-h-11 cursor-pointer py-2 text-[hsl(var(--e-muted-foreground))]">More: preview and HTML</summary>
            <div className="space-y-2 pt-1">
              <EmailPreview design={mode === "blocks" ? design : parseEmailHtml(html)} brand={brand} height={420} title="Email preview" />
              {mode === "blocks" ? (
                <EButton variant="ghost" size="sm" onClick={() => { setHtml(renderEmailHtml(design)); setMode("html"); }}>Edit as HTML instead</EButton>
              ) : (
                <EButton variant="ghost" size="sm" onClick={() => { setDesign(parseEmailHtml(html)); setMode("blocks"); }}>Edit as blocks</EButton>
              )}
            </div>
          </details>
        </section>

        <section aria-label="When it goes" className="min-w-0 space-y-2.5 border-t border-[hsl(var(--e-border))] p-4 xl:border-l xl:border-t-0">
          <StepTitle step={3}>When it goes</StepTitle>
          <OptionRow name="campaign-when" checked={when === "draft"} onSelect={() => setWhen("draft")} label={<b>Keep as draft</b>} />
          <OptionRow name="campaign-when" checked={when === "schedule"} onSelect={() => setWhen("schedule")} label={<b>Schedule</b>}>
            {when === "schedule" ? (
              <span className="mt-2 flex flex-wrap gap-1.5">
                <EInput aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[150px] max-sm:text-[1rem]" />
                <EInput aria-label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-[110px] max-sm:text-[1rem]" />
                <span className="block w-full text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{timeZone.replace(/^.*\//, "").replace(/_/g, " ")} time</span>
              </span>
            ) : null}
          </OptionRow>
          <OptionRow name="campaign-when" checked={when === "now"} onSelect={() => setWhen("now")} label={<b>Send now</b>} />
          <EButton
            variant="outline"
            size="sm"
            className="self-start"
            disabled={!campaign || dirty || Boolean(busy)}
            onClick={() => void sendTest()}
            title={!campaign || dirty ? "Save first; the test sends the saved version" : undefined}
          >
            {busy === "test" ? "Sending test…" : "Send a test to me"}
          </EButton>
          {!campaign || dirty ? <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Save first: the test sends the saved version, only to you.</p> : null}
          <ul className="space-y-1 text-[0.75rem]">
            <li className="flex gap-1.5">
              <span aria-hidden className="text-[hsl(var(--e-success))]">✓</span>
              <span>Goes to {willSend !== null ? willSend.toLocaleString("en-AU") : "the counted"} {willSend === 1 ? "person" : "people"} by email only. No SMS, no app alerts.</span>
            </li>
            {when === "schedule" ? (
              <li className="flex gap-1.5">
                <span aria-hidden className="text-[hsl(var(--e-success))]">✓</span>
                <span>The sender checks every 5 minutes, so it leaves between {time} and {addMinutes(time, 5)}.</span>
              </li>
            ) : null}
            <li className="flex gap-1.5">
              <span aria-hidden className="text-[hsl(var(--e-success))]">✓</span>
              <span>Each person gets their own email with a one-click unsubscribe. Sending limits, quiet hours and the emergency stop still apply.</span>
            </li>
            <li className="flex gap-1.5">
              <span aria-hidden className="text-[hsl(var(--e-danger))]">✕</span>
              <span>Scheduled is not sent. The row says Sent only after the email service has taken every message, with counts for sent, skipped and failed.</span>
            </li>
          </ul>
          <EButton
            className="w-full"
            disabled={primaryDisabled}
            onClick={() => (when === "draft" ? void save("draft") : setConfirm(when === "schedule" ? "schedule" : "now"))}
          >
            {primaryLabel}
          </EButton>
          {whyDisabled && primaryDisabled && !busy ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{whyDisabled}</p> : null}
          {campaign ? (
            <EButton variant="ghost" size="sm" className="text-[hsl(var(--e-danger))]" disabled={Boolean(busy)} onClick={() => setConfirm("delete")}>
              Delete campaign…
            </EButton>
          ) : null}
        </section>
      </fieldset>

      <EConfirmDialog
        open={confirm === "schedule"}
        onClose={() => setConfirm(null)}
        tier="ordinary"
        title="Schedule this campaign?"
        description={`"${name.trim()}" goes to ${willSend?.toLocaleString("en-AU") ?? 0} ${audienceName} by email on ${scheduleLabel} (organisation time), one email each.${skippedLine}`}
        confirmLabel={`Schedule for ${scheduleLabel}`}
        busy={busy === "save"}
        error={error ?? undefined}
        onConfirm={() => save("scheduled")}
      />
      <EConfirmDialog
        open={confirm === "now"}
        onClose={() => setConfirm(null)}
        tier="ordinary"
        title="Send this campaign now?"
        description={`"${name.trim()}" goes now to ${willSend?.toLocaleString("en-AU") ?? 0} ${audienceName} by email, one email each.${skippedLine}`}
        confirmLabel={`Send to ${willSend?.toLocaleString("en-AU") ?? 0} now`}
        busy={busy === "send"}
        error={error ?? undefined}
        onConfirm={() => sendNow()}
      />
      <EConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        tier="destructive"
        title={`Delete "${campaign?.name ?? "this campaign"}"?`}
        description="It is removed from this list with its send records. Emails already sent stay sent. This cannot be undone."
        confirmLabel="Delete campaign"
        busy={busy === "delete"}
        error={error ?? undefined}
        onConfirm={() => remove()}
      />
    </div>
  );
}
