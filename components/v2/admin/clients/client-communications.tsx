"use client";

/**
 * Estate per-client Communications hub.
 *
 * One place to send a client any lifecycle-stage email (with a mandatory
 * preview before sending) and to see the history of what's gone out.
 *
 * Wired to the routes this component owns:
 *   GET  /api/admin/clients/[id]/communications        → history + job picker
 *   POST /api/admin/clients/[id]/communications/send   → { mode: "preview" | "send" }
 *
 * The send is MANUAL — it always delivers (surfaces errors), so we always offer
 * a preview first. Built on the shared @/lib/notifications/lifecycle service via
 * those routes (never imported here — that module is server-only).
 *
 * Mount contract (another agent mounts this):
 *   <ClientCommunications clientId={...} />
 *
 * Estate token scope only (--e-*): primitives + estate-kit + lucide. No v1 imports.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Eye,
  Mail,
  MessageSquare,
  Bell,
  Send,
  RefreshCw,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EAlert,
} from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  ETextarea,
  ESelect,
} from "@/components/v2/admin/estate-kit";
import { useEstateToast, EToastViewport } from "@/components/v2/admin/comms/toast";

/* ── Lifecycle stages (mirror of LIFECYCLE_STAGE_LIST — kept client-side so we
 *    never bundle the server-only lifecycle service). ────────────────────── */
type LifecycleStage =
  | "BOOKING_CONFIRMED"
  | "SCHEDULE_UPDATED"
  | "REMINDER"
  | "CLEANER_ASSIGNED"
  | "JOB_COMPLETED"
  | "REPORT_READY"
  | "INVOICE_ISSUED"
  | "ISSUE_RAISED"
  | "RECLEAN_SCHEDULED"
  | "SKIP_CANCELLED"
  | "CUSTOM";

type StageMeta = { stage: LifecycleStage; label: string; description: string };

const STAGES: StageMeta[] = [
  { stage: "BOOKING_CONFIRMED", label: "Booking confirmed", description: "Confirm the clean is booked with the schedule." },
  { stage: "SCHEDULE_UPDATED", label: "Schedule changed", description: "Notify the client the date or time changed." },
  { stage: "REMINDER", label: "Upcoming clean reminder", description: "Remind the client of the upcoming clean." },
  { stage: "CLEANER_ASSIGNED", label: "Cleaner assigned", description: "Introduce the assigned cleaner." },
  { stage: "JOB_COMPLETED", label: "Clean completed", description: "Confirm the clean is finished." },
  { stage: "REPORT_READY", label: "Report ready", description: "Share the completed clean report." },
  { stage: "INVOICE_ISSUED", label: "Invoice issued", description: "Send the invoice for the clean." },
  { stage: "ISSUE_RAISED", label: "Issue raised", description: "Let the client know we found an issue we're fixing." },
  { stage: "RECLEAN_SCHEDULED", label: "Re-clean scheduled", description: "Confirm a re-clean and its new schedule." },
  { stage: "SKIP_CANCELLED", label: "Skipped / cancelled", description: "Confirm a clean was skipped or cancelled." },
  { stage: "CUSTOM", label: "Custom message", description: "Free-text message to the client." },
];

const STAGE_MAP: Record<LifecycleStage, StageMeta> = STAGES.reduce(
  (acc, s) => ((acc[s.stage] = s), acc),
  {} as Record<LifecycleStage, StageMeta>,
);

/* Which optional fields matter for each stage (drives progressive disclosure). */
const FIELD_STAGES = {
  scheduleText: new Set<LifecycleStage>([
    "BOOKING_CONFIRMED",
    "SCHEDULE_UPDATED",
    "REMINDER",
    "CLEANER_ASSIGNED",
    "RECLEAN_SCHEDULED",
    "SKIP_CANCELLED",
  ]),
  cleanerName: new Set<LifecycleStage>(["CLEANER_ASSIGNED"]),
  amount: new Set<LifecycleStage>(["INVOICE_ISSUED"]),
  reason: new Set<LifecycleStage>([
    "SCHEDULE_UPDATED",
    "ISSUE_RAISED",
    "RECLEAN_SCHEDULED",
    "SKIP_CANCELLED",
    "CUSTOM",
  ]),
};

type Job = {
  id: string;
  jobNumber: string;
  jobType: string;
  scheduledDate: string;
  status: string;
  propertyName: string | null;
};

type Notification = {
  id: string;
  channel: string;
  subject: string | null;
  body: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
  jobId: string | null;
};

type PreviewResult = {
  ok: boolean;
  stage: LifecycleStage;
  subject: string;
  html: string;
  recipients: string[];
  reason?: string;
};

function prettyJobType(t: string): string {
  return t.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function channelIcon(channel: string) {
  if (channel === "SMS") return <MessageSquare className="h-3.5 w-3.5" />;
  if (channel === "EMAIL") return <Mail className="h-3.5 w-3.5" />;
  return <Bell className="h-3.5 w-3.5" />;
}

function statusTone(status: string): "success" | "danger" | "warning" | "neutral" {
  if (status === "SENT") return "success";
  if (status === "FAILED") return "danger";
  if (status === "PENDING") return "warning";
  return "neutral";
}

function relTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

export default function ClientCommunications({ clientId }: { clientId: string }) {
  const { toast, push } = useEstateToast();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [history, setHistory] = useState<Notification[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [stage, setStage] = useState<LifecycleStage>("BOOKING_CONFIRMED");
  const [jobId, setJobId] = useState<string>("");
  const [scheduleText, setScheduleText] = useState("");
  const [reason, setReason] = useState("");
  const [cleanerName, setCleanerName] = useState("");
  const [amount, setAmount] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);

  const isCustom = stage === "CUSTOM";
  const showSchedule = FIELD_STAGES.scheduleText.has(stage);
  const showCleaner = FIELD_STAGES.cleanerName.has(stage);
  const showAmount = FIELD_STAGES.amount.has(stage);
  const showReason = FIELD_STAGES.reason.has(stage);

  const load = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/communications`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setJobs(Array.isArray(body.jobs) ? body.jobs : []);
        setHistory(Array.isArray(body.notifications) ? body.notifications : []);
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  // Any change to the composed message invalidates the current preview.
  useEffect(() => {
    setPreview(null);
  }, [stage, jobId, scheduleText, reason, cleanerName, amount, subject, bodyHtml]);

  const extra = useMemo(() => {
    const e: Record<string, unknown> = {};
    if (showSchedule && scheduleText.trim()) e.scheduleText = scheduleText.trim();
    if (showReason && reason.trim()) e.reason = reason.trim();
    if (showCleaner && cleanerName.trim()) e.cleanerName = cleanerName.trim();
    if (showAmount && amount.trim()) {
      const n = Number.parseFloat(amount);
      if (Number.isFinite(n)) e.amount = n;
    }
    if (isCustom) {
      if (subject.trim()) e.subject = subject.trim();
      if (bodyHtml.trim()) e.bodyHtml = bodyHtml.trim();
    }
    return e;
  }, [showSchedule, scheduleText, showReason, reason, showCleaner, cleanerName, showAmount, amount, isCustom, subject, bodyHtml]);

  async function callSend(mode: "preview" | "send") {
    const res = await fetch(`/api/admin/clients/${clientId}/communications/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage,
        mode,
        jobId: jobId || undefined,
        extra: Object.keys(extra).length ? extra : undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body };
  }

  async function doPreview() {
    setPreviewing(true);
    try {
      const { ok, body } = await callSend("preview");
      if (!ok) {
        push({ title: "Preview failed", description: body.error ?? "Could not build the preview.", tone: "danger" });
        return;
      }
      setPreview(body as PreviewResult);
    } finally {
      setPreviewing(false);
    }
  }

  async function doSend() {
    setSending(true);
    try {
      const { ok, body } = await callSend("send");
      if (!ok) {
        push({ title: "Send failed", description: body.error ?? "The email could not be sent.", tone: "danger" });
        return;
      }
      const recipients: string[] = Array.isArray(body.recipients) ? body.recipients : [];
      push({
        title: "Message sent",
        description: recipients.length ? `Delivered to ${recipients.join(", ")}.` : undefined,
        tone: "success",
      });
      setPreview(null);
      await load();
    } finally {
      setSending(false);
    }
  }

  const canSend = !sending && !previewing;

  return (
    <div className="space-y-5">
      {/* ── Send an update ─────────────────────────────────────────────── */}
      <ECard>
        <ECardHeader className="flex-row items-center gap-2 pb-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold))]">
            <Send className="h-4 w-4" />
          </span>
          <div>
            <ECardTitle className="text-[0.95rem]">Send an update</ECardTitle>
            <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
              Compose a lifecycle email — preview it, then send. Manual sends always deliver.
            </p>
          </div>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Update type" hint={STAGE_MAP[stage].description}>
              <ESelect value={stage} onChange={(e) => setStage(e.target.value as LifecycleStage)}>
                {STAGES.map((s) => (
                  <option key={s.stage} value={s.stage}>{s.label}</option>
                ))}
              </ESelect>
            </EField>
            <EField label="Related job" hint="Optional — pick a job to personalise the message, or keep it account-level.">
              <ESelect value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">No specific job / account-level</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    #{j.jobNumber} · {prettyJobType(j.jobType)}
                    {j.propertyName ? ` · ${j.propertyName}` : ""}
                  </option>
                ))}
              </ESelect>
            </EField>
          </div>

          {(showSchedule || showCleaner || showAmount) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {showSchedule && (
                <EField label="Schedule text" hint="Overrides the job's schedule in the message.">
                  <EInput
                    value={scheduleText}
                    placeholder="e.g. Tue 15 Jul at 10:00am"
                    onChange={(e) => setScheduleText(e.target.value)}
                  />
                </EField>
              )}
              {showCleaner && (
                <EField label="Cleaner name">
                  <EInput
                    value={cleanerName}
                    placeholder="e.g. Sarah"
                    onChange={(e) => setCleanerName(e.target.value)}
                  />
                </EField>
              )}
              {showAmount && (
                <EField label="Amount due (AUD)">
                  <EInput
                    type="number"
                    min={0}
                    step="0.01"
                    value={amount}
                    placeholder="e.g. 180.00"
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </EField>
              )}
            </div>
          )}

          {isCustom && (
            <EField label="Subject" hint="The email subject line for this custom message.">
              <EInput
                value={subject}
                placeholder="An update on your clean"
                onChange={(e) => setSubject(e.target.value)}
              />
            </EField>
          )}

          {showReason && !isCustom && (
            <EField label="Reason / note" hint="Optional context shown in the message.">
              <ETextarea
                value={reason}
                rows={3}
                placeholder="Add any detail the client should know…"
                onChange={(e) => setReason(e.target.value)}
              />
            </EField>
          )}

          {isCustom && (
            <EField label="Message body" hint="Plain text or simple HTML. This becomes the body of the email.">
              <ETextarea
                value={bodyHtml}
                rows={5}
                placeholder="<p>Hi there, just wanted to let you know…</p>"
                onChange={(e) => setBodyHtml(e.target.value)}
              />
            </EField>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <EButton variant="outline" size="sm" onClick={doPreview} disabled={previewing || sending}>
              <Eye className="h-4 w-4" />
              {previewing ? "Building…" : "Preview"}
            </EButton>
            <EButton size="sm" onClick={doSend} disabled={!canSend}>
              <Send className="h-4 w-4" />
              {sending ? "Sending…" : "Send now"}
            </EButton>
          </div>

          {/* Resolved preview */}
          {preview && (
            <div className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-surface-raised))] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <EBadge tone="gold" soft>Preview</EBadge>
                <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  <Users className="h-3.5 w-3.5" />
                  {preview.recipients.length
                    ? preview.recipients.join(", ")
                    : "No recipients on file"}
                </span>
              </div>
              {!preview.recipients.length && (
                <EAlert tone="warning" title="No recipient email">
                  {preview.reason ?? "This client has no email on file — sending will fail."}
                </EAlert>
              )}
              <div>
                <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-text-faint))]">Subject</p>
                <p className="text-[0.9375rem] font-[550] text-[hsl(var(--e-foreground))]">{preview.subject}</p>
              </div>
              <div>
                <p className="mb-1 text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-text-faint))]">Body</p>
                <div
                  className="max-h-[46vh] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 text-[0.875rem] leading-relaxed text-[hsl(var(--e-foreground))] [&_a]:text-[hsl(var(--e-gold-ink))] [&_a]:underline [&_p]:my-2"
                  dangerouslySetInnerHTML={{ __html: preview.html }}
                />
              </div>
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* ── Sent history ───────────────────────────────────────────────── */}
      <ECard>
        <ECardHeader className="flex-row items-center justify-between pb-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]">
              <Mail className="h-4 w-4" />
            </span>
            <div>
              <ECardTitle className="text-[0.95rem]">Sent history</ECardTitle>
              <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                {loadingHistory ? "Loading…" : `${history.length} message${history.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
          <EButton size="sm" variant="ghost" onClick={load} disabled={loadingHistory} aria-label="Refresh history">
            <RefreshCw className={`h-4 w-4 ${loadingHistory ? "animate-spin" : ""}`} />
            Refresh
          </EButton>
        </ECardHeader>
        <ECardBody className="pt-0">
          {loadingHistory ? (
            <p className="py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading history…</p>
          ) : history.length === 0 ? (
            <EEmptyState
              eyebrow="Nothing sent yet"
              title="No messages on record"
              description="Emails sent to this client — whether automatically or from here — will appear in this feed."
            />
          ) : (
            <ul className="space-y-2">
              {history.map((n) => {
                const job = n.jobId ? jobs.find((j) => j.id === n.jobId) : null;
                const when = n.sentAt ?? n.createdAt;
                const tone = statusTone(n.status);
                return (
                  <li
                    key={n.id}
                    className="flex items-start gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3.5 py-3"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))]">
                      {channelIcon(n.channel)}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">
                          {n.subject || n.channel}
                        </p>
                        <EBadge tone={tone} soft>
                          {tone === "success" ? <CheckCircle2 className="h-3 w-3" /> : tone === "danger" ? <XCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                          {n.status}
                        </EBadge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                        <span>{relTime(when)}</span>
                        {n.jobId ? (
                          <span>· {job ? `#${job.jobNumber}` : "Linked job"}</span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ECardBody>
      </ECard>

      <EToastViewport toast={toast} />
    </div>
  );
}
