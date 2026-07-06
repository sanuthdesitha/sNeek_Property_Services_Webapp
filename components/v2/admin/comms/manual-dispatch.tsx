"use client";

/**
 * ESTATE manual dispatch — v2-native rebuild of the v1 ScheduledNotificationControls.
 * Same API surface:
 *   run     → POST /api/admin/notifications/dispatch          { dispatchType, force: true }
 *   resend  → POST /api/admin/notifications/dispatch/resend   { jobId, channel }
 * Reads the enabled flags / times from GET /api/admin/settings (scheduledNotifications).
 */
import { useEffect, useState } from "react";
import { SendHorizonal } from "lucide-react";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";

type DispatchType = "REMINDER_24H" | "REMINDER_2H" | "TOMORROW_PREP" | "STOCK_ALERTS" | "ADMIN_ATTENTION";

type RecipientResult = {
  jobId: string;
  jobNumber: string;
  propertyName: string;
  recipient: string;
  contact: string;
  channel: "email" | "sms";
  status: "sent" | "failed" | "skipped";
  error?: string;
};

type ScheduledSettings = {
  reminder24hEnabled: boolean;
  reminder2hEnabled: boolean;
  tomorrowPrepEnabled: boolean;
  tomorrowPrepTime: string;
  stockAlertsEnabled: boolean;
  stockAlertsTime: string;
  adminAttentionSummaryEnabled: boolean;
  adminAttentionSummaryTime: string;
};

type ToastFn = (t: { title: string; description?: string; tone: "success" | "danger" }) => void;

const DISPATCH_ROWS: Array<{ type: DispatchType; title: string; description: string }> = [
  {
    type: "REMINDER_24H",
    title: "24-hour job reminders",
    description: "Send the scheduled email reminder flow for jobs currently in the 24-hour window.",
  },
  {
    type: "REMINDER_2H",
    title: "2-hour job reminders",
    description: "Send the scheduled SMS reminder flow for jobs currently in the 2-hour window.",
  },
  {
    type: "TOMORROW_PREP",
    title: "Tomorrow prep dispatch",
    description: "Send tomorrow job summaries and critical stock alerts using the live recipient lists.",
  },
  {
    type: "STOCK_ALERTS",
    title: "Critical stock alerts",
    description: "Send the daily low-stock alert to admin and ops contacts now.",
  },
  {
    type: "ADMIN_ATTENTION",
    title: "Admin attention summary",
    description: "Send the daily admin summary with approvals, unassigned jobs, cases, and flagged tasks now.",
  },
];

function describeResult(dispatchType: DispatchType, result: any): string {
  if (!result || typeof result !== "object") return "Dispatch finished.";
  if (Array.isArray(result.skipped) && result.skipped.length > 0) return result.skipped.join(" ");
  if (typeof result.skipped === "string") return result.skipped.replace(/_/g, " ");
  if (dispatchType === "REMINDER_24H") {
    return `Candidates: ${result.longCandidates ?? 0}. Sent: ${result.longSent ?? 0}.${result.longTargetDate ? ` Target date: ${result.longTargetDate}.` : ""}`;
  }
  if (dispatchType === "REMINDER_2H") {
    return `Candidates: ${result.shortCandidates ?? 0}. Sent: ${result.shortSent ?? 0}.${result.shortTargetDate ? ` Target date: ${result.shortTargetDate}.` : ""}`;
  }
  if (dispatchType === "TOMORROW_PREP") {
    return `Jobs: ${result.jobs ?? 0}. Cleaner recipients: ${result.cleanerRecipients ?? 0}. Laundry recipients: ${result.laundryRecipients ?? 0}. Critical stock items: ${result.criticalStocks ?? 0}.${result.targetDateLabel ? ` Target date: ${result.targetDateLabel}.` : ""}`;
  }
  if (dispatchType === "STOCK_ALERTS") {
    return `Low stock items: ${result.lowStocks ?? 0}. Admin recipients: ${result.admins ?? 0}. Emails sent: ${result.sent ?? 0}.`;
  }
  if (dispatchType === "ADMIN_ATTENTION") {
    return `Admins: ${result.admins ?? 0}. Emails sent: ${result.sentEmails ?? 0}. SMS sent: ${result.sentSms ?? 0}. Attention items: ${result.attentionCount ?? 0}.`;
  }
  return "Dispatch finished.";
}

export function CommsManualDispatch({ onToast }: { onToast: ToastFn }) {
  const [settings, setSettings] = useState<ScheduledSettings | null>(null);
  const [runningType, setRunningType] = useState<DispatchType | null>(null);
  const [recipientsByType, setRecipientsByType] = useState<Partial<Record<DispatchType, RecipientResult[]>>>({});
  const [resendingKey, setResendingKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((res) => res.json().catch(() => null))
      .then((body) => {
        if (body?.scheduledNotifications) setSettings(body.scheduledNotifications as ScheduledSettings);
      })
      .catch(() => setSettings(null));
  }, []);

  async function runDispatch(dispatchType: DispatchType) {
    setRunningType(dispatchType);
    try {
      const res = await fetch("/api/admin/notifications/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchType, force: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) throw new Error(payload.error ?? "Manual dispatch failed.");
      if (Array.isArray(payload.result?.recipients)) {
        setRecipientsByType((prev) => ({ ...prev, [dispatchType]: payload.result.recipients }));
      }
      onToast({ title: "Manual dispatch complete", description: describeResult(dispatchType, payload.result), tone: "success" });
    } catch (err: any) {
      onToast({ title: "Manual dispatch failed", description: err?.message ?? "Could not run manual dispatch.", tone: "danger" });
    } finally {
      setRunningType(null);
    }
  }

  async function resendOne(dispatchType: DispatchType, target: RecipientResult, index: number) {
    const key = `${dispatchType}-${index}`;
    setResendingKey(key);
    try {
      const res = await fetch("/api/admin/notifications/dispatch/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: target.jobId, channel: target.channel }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) throw new Error(payload.error ?? "Resend failed.");
      const updated: RecipientResult[] = Array.isArray(payload.recipients) ? payload.recipients : [];
      const match = updated.find((r) => r.contact === target.contact) ?? updated[0];
      if (match) {
        setRecipientsByType((prev) => {
          const list = [...(prev[dispatchType] ?? [])];
          list[index] = match;
          return { ...prev, [dispatchType]: list };
        });
      }
      onToast({
        title: match?.status === "sent" ? "Resent" : "Resend did not deliver",
        description: `${target.recipient} — ${match?.status ?? "unknown"}${match?.error ? `: ${match.error}` : ""}`,
        tone: match?.status === "sent" ? "success" : "danger",
      });
    } catch (err: any) {
      onToast({ title: "Resend failed", description: err?.message ?? "Could not resend.", tone: "danger" });
    } finally {
      setResendingKey(null);
    }
  }

  function rowMeta(type: DispatchType): { enabled: boolean; timeLabel: string | null } {
    if (!settings) return { enabled: true, timeLabel: null };
    switch (type) {
      case "REMINDER_24H":
        return { enabled: settings.reminder24hEnabled, timeLabel: null };
      case "REMINDER_2H":
        return { enabled: settings.reminder2hEnabled, timeLabel: null };
      case "TOMORROW_PREP":
        return { enabled: settings.tomorrowPrepEnabled, timeLabel: settings.tomorrowPrepTime };
      case "STOCK_ALERTS":
        return { enabled: settings.stockAlertsEnabled, timeLabel: settings.stockAlertsTime };
      case "ADMIN_ATTENTION":
        return { enabled: settings.adminAttentionSummaryEnabled, timeLabel: settings.adminAttentionSummaryTime };
      default:
        return { enabled: true, timeLabel: null };
    }
  }

  return (
    <div className="space-y-3">
      {DISPATCH_ROWS.map((row) => {
        const meta = rowMeta(row.type);
        const recips = recipientsByType[row.type] ?? [];
        const failed = recips.filter((r) => r.status !== "sent").length;
        return (
          <ECard key={row.type} className="space-y-3 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[0.9375rem] font-[550]">{row.title}</p>
                  <EBadge tone={meta.enabled ? "success" : "neutral"} soft>
                    {meta.enabled ? "Enabled" : "Disabled"}
                  </EBadge>
                  {meta.timeLabel ? <EBadge tone="neutral" soft>{meta.timeLabel}</EBadge> : null}
                </div>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{row.description}</p>
              </div>
              <EButton
                variant="outline-gold"
                size="sm"
                onClick={() => runDispatch(row.type)}
                disabled={runningType === row.type}
              >
                <SendHorizonal className="h-3.5 w-3.5" />
                {runningType === row.type ? "Sending…" : "Send now"}
              </EButton>
            </div>

            {recips.length > 0 ? (
              <div className="space-y-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.4)] p-2.5">
                <p className="text-[0.75rem] font-[550]">
                  {recips.length} recipient{recips.length === 1 ? "" : "s"} · {recips.length - failed} sent
                  {failed > 0 ? ` · ${failed} need attention` : ""}
                </p>
                <div className="space-y-1">
                  {recips.map((r, index) => {
                    const key = `${row.type}-${index}`;
                    return (
                      <div
                        key={key}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-1.5 text-[0.75rem]"
                      >
                        <div className="min-w-0">
                          <span className="font-[550]">{r.recipient}</span>
                          <span className="text-[hsl(var(--e-muted-foreground))]">
                            {" "}· {r.jobNumber} · {r.propertyName}
                          </span>
                          {r.error ? <span className="block text-[hsl(var(--e-danger))]">{r.error}</span> : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <EBadge tone={r.status === "sent" ? "success" : r.status === "failed" ? "danger" : "neutral"} soft>
                            {r.status}
                          </EBadge>
                          {r.status !== "sent" ? (
                            <EButton
                              size="sm"
                              variant="outline"
                              disabled={resendingKey === key}
                              onClick={() => resendOne(row.type, r, index)}
                            >
                              {resendingKey === key ? "Resending…" : "Resend"}
                            </EButton>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </ECard>
        );
      })}
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Manual dispatch uses the live recipient lists and templates. Automatic schedules continue to run normally.
      </p>
    </div>
  );
}
