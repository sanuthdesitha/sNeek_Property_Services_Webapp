"use client";

/**
 * v1 admin · Message channels — the OUTER gate on all outbound messaging.
 *
 *   1. Global channel masters — kill every outbound Email / SMS / Push message
 *      of that channel at once (critical login/security email always sends).
 *   2. Audience matrix — per-audience Email/SMS/Push toggles, disabled (state
 *      still visible) when the matching global master is off.
 *
 * Saves via PATCH /api/admin/settings under `notificationAudienceControls`,
 * mirroring the shadcn SettingsEditor save pattern (toast, no reload). Per-type
 * automatic-email toggles and per-user preferences still apply on top.
 */
import { useMemo, useState } from "react";
import { Mail, MessageSquare, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import {
  NOTIFICATION_AUDIENCES,
  DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS,
  type NotificationAudience,
  type NotificationAudienceControls,
} from "@/lib/notifications/audience-controls";

type ChannelKey = "email" | "sms" | "push";

const CHANNELS: Array<{ key: ChannelKey; label: string; icon: JSX.Element }> = [
  { key: "email", label: "Email", icon: <Mail className="h-3.5 w-3.5" /> },
  { key: "sms", label: "SMS", icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { key: "push", label: "Push", icon: <Bell className="h-3.5 w-3.5" /> },
];

const AUDIENCE_DESCRIPTIONS: Record<NotificationAudience, string> = {
  CLIENT: "Booking updates, reports, invoices, lifecycle emails",
  CLEANER: "Job assignments, schedule changes, reminders, pay updates",
  LAUNDRY: "Pickup and drop-off schedules, ready-queue alerts",
  MAINTENANCE: "Repair job assignments, access details, visit reminders",
  QA: "Inspection queue, rework alerts, feedback routing",
  STAFF_ADMIN: "Admin and ops summaries, escalations, system alerts",
  PUBLIC: "Quote follow-ups, lead alerts, marketing to contacts without accounts",
};

const MASTER_COPY: Record<ChannelKey, string> = {
  email: "Kills ALL outbound email except critical login and security messages.",
  sms: "Kills ALL outbound SMS across every audience.",
  push: "Kills ALL push notifications across every audience.",
};

export function NotificationAudienceSettings({
  initial,
  readOnly,
}: {
  initial: NotificationAudienceControls;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState<NotificationAudienceControls>(() =>
    JSON.parse(JSON.stringify(initial ?? DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS))
  );
  const [saved, setSaved] = useState<NotificationAudienceControls>(() =>
    JSON.parse(JSON.stringify(initial ?? DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS))
  );
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  );

  function setMaster(channel: ChannelKey, value: boolean) {
    setDraft((prev) => ({ ...prev, channels: { ...prev.channels, [channel]: value } }));
  }

  function setAudienceChannel(audience: NotificationAudience, channel: ChannelKey, value: boolean) {
    setDraft((prev) => ({
      ...prev,
      audiences: {
        ...prev.audiences,
        [audience]: { ...prev.audiences[audience], [channel]: value },
      },
    }));
  }

  async function save() {
    if (readOnly || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationAudienceControls: draft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Failed to save", description: body.error ?? "Try again.", variant: "destructive" });
        return;
      }
      const next = (body?.notificationAudienceControls ?? draft) as NotificationAudienceControls;
      setDraft(JSON.parse(JSON.stringify(next)));
      setSaved(JSON.parse(JSON.stringify(next)));
      toast({ title: "Message channel settings saved" });
    } catch {
      toast({ title: "Failed to save", description: "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Global channel masters ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Global channel masters</CardTitle>
          <CardDescription>
            The outer gate on all outbound messaging. Turn a channel off and nothing of that
            kind goes out — no per-type or per-user setting can override it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {CHANNELS.map((ch) => (
            <div key={ch.key} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{ch.icon}</span>
                  <p className="text-sm font-medium">{ch.label} sending</p>
                </div>
                <p className="text-xs text-muted-foreground">{MASTER_COPY[ch.key]}</p>
              </div>
              <Switch
                checked={draft.channels[ch.key]}
                onCheckedChange={(v) => setMaster(ch.key, v)}
                disabled={readOnly}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Audience matrix ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audience matrix</CardTitle>
          <CardDescription>
            Which channels reach each audience. Cells are disabled (state still shown) when the
            matching global master above is off.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4 text-xs font-medium uppercase text-muted-foreground">Audience</th>
                  {CHANNELS.map((ch) => (
                    <th
                      key={ch.key}
                      className="px-3 py-2 text-center text-xs font-medium uppercase text-muted-foreground"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {ch.icon}
                        {ch.label}
                        {!draft.channels[ch.key] ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[0.5625rem] normal-case">
                            off
                          </Badge>
                        ) : null}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_AUDIENCES.map((aud) => {
                  const key = aud.key as NotificationAudience;
                  const row = draft.audiences[key];
                  return (
                    <tr key={key} className="border-b align-top last:border-0">
                      <td className="py-3 pr-4">
                        <p className="text-sm font-medium">{aud.label}</p>
                        <p className="text-xs text-muted-foreground">{AUDIENCE_DESCRIPTIONS[key] ?? ""}</p>
                      </td>
                      {CHANNELS.map((ch) => {
                        const masterOff = !draft.channels[ch.key];
                        return (
                          <td
                            key={ch.key}
                            className={"px-3 py-3 text-center" + (masterOff ? " opacity-40" : "")}
                          >
                            <div className="flex justify-center">
                              <Switch
                                checked={Boolean(row?.[ch.key])}
                                onCheckedChange={(v) => setAudienceChannel(key, ch.key, v)}
                                disabled={readOnly || masterOff}
                              />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            This matrix is the outer gate only. Per-type automatic-email toggles (Email
            automation) and each user&apos;s own notification preferences still apply on top —
            turning a channel on here does not force a message those layers suppress.
          </p>

          <div className="flex items-center justify-end gap-3">
            {readOnly ? (
              <p className="text-xs text-muted-foreground">Read-only — administrator access required to edit.</p>
            ) : (
              <Button onClick={save} disabled={saving || !dirty}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
