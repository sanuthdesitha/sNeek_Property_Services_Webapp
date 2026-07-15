"use client";

/**
 * Settings → Message channels. The OUTER gate on all outbound messaging.
 *
 * Two layers:
 *   1. Global channel masters — kill every outbound Email / SMS / Push message
 *      of that channel at once (critical login/security email always sends).
 *   2. Audience matrix — per-audience Email/SMS/Push toggles. A cell is muted +
 *      disabled when its global master is off (state still shown, just gated).
 *
 * Saves the whole blob via PATCH /api/admin/settings under
 * `notificationAudienceControls`; the server clamps it in lib/settings.ts.
 * Per-type automatic-email toggles and per-user preferences still apply on top.
 */
import { useMemo, useState } from "react";
import { Mail, MessageSquare, Bell } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EToggle, ESaveStatus, ESectionHeading, useSaveStatus } from "./estate-form";
import {
  NOTIFICATION_AUDIENCES,
  DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS,
  type NotificationAudience,
  type NotificationAudienceControls,
} from "@/lib/notifications/audience-controls";

type ChannelKey = "email" | "sms" | "push";

const CHANNELS: Array<{ key: ChannelKey; label: string; icon: JSX.Element }> = [
  { key: "email", label: "Email", icon: <Mail className="h-4 w-4" /> },
  { key: "sms", label: "SMS", icon: <MessageSquare className="h-4 w-4" /> },
  { key: "push", label: "Push", icon: <Bell className="h-4 w-4" /> },
];

/** One-line description of who each audience is + what they receive. */
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

export function NotificationAudienceSection({
  initial,
  readOnly,
}: {
  initial: NotificationAudienceControls;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState<NotificationAudienceControls>(() =>
    JSON.parse(JSON.stringify(initial ?? DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS))
  );
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initial),
    [draft, initial]
  );

  function setMaster(channel: ChannelKey, value: boolean) {
    setDraft((prev) => ({ ...prev, channels: { ...prev.channels, [channel]: value } }));
  }

  function setAudienceChannel(
    audience: NotificationAudience,
    channel: ChannelKey,
    value: boolean
  ) {
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
        flash("error", body.error ?? "Could not save settings.");
        return;
      }
      flash("saved", "Message channel settings saved");
    } catch {
      flash("error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Messaging"
        title="Message channels"
        description="The outer gate on every outbound message. Turn a channel off here and nothing of that kind goes out — no per-type or per-user setting can override it."
      />

      {/* ── Global channel masters ─────────────────────────────────────────── */}
      <ECard className="space-y-4 p-5">
        <div>
          <h3 className="text-[0.9375rem] font-semibold">Global channel masters</h3>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Master kill-switches for each channel. When off, the whole column in the matrix
            below is disabled.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {CHANNELS.map((ch) => (
            <div
              key={ch.key}
              className="flex items-start justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[hsl(var(--e-muted-foreground))]">{ch.icon}</span>
                  <p className="text-[0.875rem] font-medium">{ch.label} sending</p>
                </div>
                <p className="mt-1 text-[0.75rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">
                  {MASTER_COPY[ch.key]}
                </p>
              </div>
              <EToggle
                checked={draft.channels[ch.key]}
                disabled={readOnly}
                onChange={(v) => setMaster(ch.key, v)}
              />
            </div>
          ))}
        </div>
      </ECard>

      {/* ── Audience matrix ────────────────────────────────────────────────── */}
      <ECard className="space-y-4 p-5">
        <div>
          <h3 className="text-[0.9375rem] font-semibold">Audience matrix</h3>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Which channels reach each audience. Cells are disabled (state still shown) when
            the matching global master above is off.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-[hsl(var(--e-border))]">
                <th className="py-2 pr-4 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-text-secondary))]">
                  Audience
                </th>
                {CHANNELS.map((ch) => (
                  <th
                    key={ch.key}
                    className="px-3 py-2 text-center text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-text-secondary))]"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {ch.icon}
                      {ch.label}
                      {!draft.channels[ch.key] ? (
                        <span className="rounded-full bg-[hsl(var(--e-surface-sunken))] px-1.5 py-0.5 text-[0.5625rem] font-medium normal-case tracking-normal text-[hsl(var(--e-text-faint))]">
                          off
                        </span>
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
                  <tr
                    key={key}
                    className="border-b border-[hsl(var(--e-border))] last:border-0 align-top"
                  >
                    <td className="py-3 pr-4">
                      <p className="text-[0.875rem] font-medium">{aud.label}</p>
                      <p className="text-[0.75rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">
                        {AUDIENCE_DESCRIPTIONS[key] ?? ""}
                      </p>
                    </td>
                    {CHANNELS.map((ch) => {
                      const masterOff = !draft.channels[ch.key];
                      return (
                        <td
                          key={ch.key}
                          className={
                            "px-3 py-3 text-center" + (masterOff ? " opacity-40" : "")
                          }
                        >
                          <div className="flex justify-center">
                            <EToggle
                              checked={Boolean(row?.[ch.key])}
                              disabled={readOnly || masterOff}
                              onChange={(v) => setAudienceChannel(key, ch.key, v)}
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

        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-4">
          <p className="text-[0.8125rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">
            This matrix is the outer gate only. Per-type automatic-email toggles (Email
            automation) and each user&apos;s own notification preferences still apply on top —
            turning a channel on here does not force a message that those layers suppress.
          </p>
        </div>
      </ECard>

      <div className="flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        {!readOnly ? (
          <EButton onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save changes"}
          </EButton>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
            Read-only — administrator access required to edit.
          </p>
        )}
      </div>
    </div>
  );
}
