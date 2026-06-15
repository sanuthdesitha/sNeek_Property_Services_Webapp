"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import type { ScheduledNotificationSettings } from "@/lib/settings";

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

interface ScheduledNotificationControlsProps {
  settings: ScheduledNotificationSettings;
}

const DISPATCH_ROWS: Array<{
  type: DispatchType;
  title: string;
  description: string;
}> = [
  {
    type: "REMINDER_24H",
    title: "24-hour job reminders",
    description: "Send the scheduled email reminder flow for jobs currently in the 24-hour reminder window.",
  },
  {
    type: "REMINDER_2H",
    title: "2-hour job reminders",
    description: "Send the scheduled SMS reminder flow for jobs currently in the 2-hour reminder window.",
  },
  {
    type: "TOMORROW_PREP",
    title: "Tomorrow prep dispatch",
    description: "Send tomorrow job summaries and critical stock alerts now using the live recipient lists.",
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

export function ScheduledNotificationControls({ settings }: ScheduledNotificationControlsProps) {
  const [runningType, setRunningType] = useState<DispatchType | null>(null);
  const [recipientsByType, setRecipientsByType] = useState<Partial<Record<DispatchType, RecipientResult[]>>>({});
  const [resendingKey, setResendingKey] = useState<string | null>(null);

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
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Resend failed.");
      }
      // Reflect the new status for this job/channel from the resend result.
      const updated: RecipientResult[] = Array.isArray(payload.recipients) ? payload.recipients : [];
      const match = updated.find((r) => r.contact === target.contact) ?? updated[0];
      if (match) {
        setRecipientsByType((prev) => {
          const list = [...(prev[dispatchType] ?? [])];
          list[index] = match;
          return { ...prev, [dispatchType]: list };
        });
      }
      toast({
        title: match?.status === "sent" ? "Resent" : "Resend did not deliver",
        description: `${target.recipient} — ${match?.status ?? "unknown"}${match?.error ? `: ${match.error}` : ""}`,
        variant: match?.status === "sent" ? undefined : "destructive",
      });
    } catch (err: any) {
      toast({ title: "Resend failed", description: err.message ?? "Could not resend.", variant: "destructive" });
    } finally {
      setResendingKey(null);
    }
  }

  function describeResult(dispatchType: DispatchType, result: any) {
    if (!result || typeof result !== "object") return "Dispatch finished.";

    if (Array.isArray(result.skipped) && result.skipped.length > 0) {
      return result.skipped.join(" ");
    }
    if (typeof result.skipped === "string") {
      return result.skipped.replace(/_/g, " ");
    }

    if (dispatchType === "REMINDER_24H") {
      const target = result.longTargetDate ? ` Target date: ${result.longTargetDate}.` : "";
      return `Candidates: ${result.longCandidates ?? 0}. Sent: ${result.longSent ?? 0}.${target}`;
    }
    if (dispatchType === "REMINDER_2H") {
      const target = result.shortTargetDate ? ` Target date: ${result.shortTargetDate}.` : "";
      return `Candidates: ${result.shortCandidates ?? 0}. Sent: ${result.shortSent ?? 0}.${target}`;
    }
    if (dispatchType === "TOMORROW_PREP") {
      return `Jobs: ${result.jobs ?? 0}. Cleaner recipients: ${result.cleanerRecipients ?? 0}. Laundry recipients: ${
        result.laundryRecipients ?? 0
      }. Critical stock items: ${result.criticalStocks ?? 0}.${result.targetDateLabel ? ` Target date: ${result.targetDateLabel}.` : ""}`;
    }
    if (dispatchType === "STOCK_ALERTS") {
      return `Low stock items: ${result.lowStocks ?? 0}. Admin recipients: ${result.admins ?? 0}. Emails sent: ${result.sent ?? 0}.`;
    }
    if (dispatchType === "ADMIN_ATTENTION") {
      return `Admins: ${result.admins ?? 0}. Emails sent: ${result.sentEmails ?? 0}. SMS sent: ${result.sentSms ?? 0}. Attention items: ${result.attentionCount ?? 0}.`;
    }

    return "Dispatch finished.";
  }

  async function runDispatch(dispatchType: DispatchType) {
    setRunningType(dispatchType);
    try {
      const res = await fetch("/api/admin/notifications/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchType, force: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Manual dispatch failed.");
      }
      if (Array.isArray(payload.result?.recipients)) {
        setRecipientsByType((prev) => ({ ...prev, [dispatchType]: payload.result.recipients }));
      }
      toast({
        title: "Manual dispatch complete",
        description: describeResult(dispatchType, payload.result),
      });
    } catch (err: any) {
      toast({
        title: "Manual dispatch failed",
        description: err.message ?? "Could not run manual dispatch.",
        variant: "destructive",
      });
    } finally {
      setRunningType(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Manual Scheduled Dispatch</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {DISPATCH_ROWS.map((row) => {
          const enabled =
            row.type === "REMINDER_24H"
              ? settings.reminder24hEnabled
              : row.type === "REMINDER_2H"
                ? settings.reminder2hEnabled
                  : row.type === "TOMORROW_PREP"
                    ? settings.tomorrowPrepEnabled
                    : row.type === "STOCK_ALERTS"
                      ? settings.stockAlertsEnabled
                      : settings.adminAttentionSummaryEnabled;
          const timeLabel =
            row.type === "TOMORROW_PREP"
              ? settings.tomorrowPrepTime
              : row.type === "STOCK_ALERTS"
                ? settings.stockAlertsTime
                : row.type === "ADMIN_ATTENTION"
                  ? settings.adminAttentionSummaryTime
                : null;

          return (
            <div key={row.type} className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{row.title}</p>
                    <Badge variant={enabled ? "success" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
                    {timeLabel ? <Badge variant="outline">{timeLabel}</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{row.description}</p>
                </div>
                <Button onClick={() => runDispatch(row.type)} disabled={runningType === row.type}>
                  {runningType === row.type ? "Sending..." : "Send now"}
                </Button>
              </div>
              {(() => {
                const recips = recipientsByType[row.type] ?? [];
                if (recips.length === 0) return null;
                const failed = recips.filter((r) => r.status !== "sent").length;
                return (
                  <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
                    <p className="text-xs font-medium">
                      {recips.length} recipient(s) · {recips.length - failed} sent
                      {failed > 0 ? ` · ${failed} need attention` : ""}
                    </p>
                    <div className="space-y-1">
                      {recips.map((r, index) => {
                        const key = `${row.type}-${index}`;
                        return (
                          <div
                            key={key}
                            className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background px-2 py-1.5 text-xs"
                          >
                            <div className="min-w-0">
                              <span className="font-medium">{r.recipient}</span>
                              <span className="text-muted-foreground">
                                {" "}· {r.jobNumber} · {r.propertyName}
                              </span>
                              {r.error ? <span className="block text-destructive">{r.error}</span> : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  r.status === "sent" ? "success" : r.status === "failed" ? "destructive" : "secondary"
                                }
                              >
                                {r.status}
                              </Badge>
                              {r.status !== "sent" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2"
                                  disabled={resendingKey === key}
                                  onClick={() => resendOne(row.type, r, index)}
                                >
                                  {resendingKey === key ? "Resending…" : "Resend"}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Manual dispatch uses the live recipient lists and templates. Automatic schedules continue to run normally.
        </p>
      </CardContent>
    </Card>
  );
}
