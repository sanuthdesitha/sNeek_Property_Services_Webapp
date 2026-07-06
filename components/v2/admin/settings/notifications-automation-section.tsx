"use client";

import { useState } from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  EToggle,
  ESaveStatus,
  ESectionHeading,
  useSaveStatus,
} from "./estate-form";

/**
 * Scheduled notification automation + defaults. Mirrors the v1 editor's
 * `scheduledNotifications.*` block and the `notificationDefaults.categories`
 * channel matrix. Categories are iterated dynamically exactly as v1 does, so
 * the same partial body PATCHes back with identical keys.
 */
type ChannelPref = { web?: boolean; email?: boolean; sms?: boolean };

export type NotificationsAutomationSettings = {
  scheduledNotifications: {
    reminder24hEnabled: boolean;
    reminder2hEnabled: boolean;
    tomorrowPrepEnabled: boolean;
    tomorrowPrepTime: string;
    stockAlertsEnabled: boolean;
    stockAlertsTime: string;
    adminAttentionSummaryEnabled: boolean;
    adminAttentionSummaryTime: string;
    autoApproveLaundrySyncDrafts: boolean;
    laundrySyncNotificationHorizonDays: number;
  };
  notificationDefaults: {
    categories: Record<string, ChannelPref>;
  };
};

const CHANNELS: Array<keyof ChannelPref> = ["web", "email", "sms"];

export function NotificationsAutomationSection({
  initial,
  readOnly,
}: {
  initial: NotificationsAutomationSettings;
  readOnly: boolean;
}) {
  const [form, setForm] = useState<NotificationsAutomationSettings>(initial);
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  function setSched<K extends keyof NotificationsAutomationSettings["scheduledNotifications"]>(
    key: K,
    value: NotificationsAutomationSettings["scheduledNotifications"][K]
  ) {
    setForm((p) => ({ ...p, scheduledNotifications: { ...p.scheduledNotifications, [key]: value } }));
  }

  function setChannel(category: string, channel: keyof ChannelPref, value: boolean) {
    setForm((p) => ({
      ...p,
      notificationDefaults: {
        ...p.notificationDefaults,
        categories: {
          ...p.notificationDefaults.categories,
          [category]: { ...p.notificationDefaults.categories[category], [channel]: value },
        },
      },
    }));
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledNotifications: form.scheduledNotifications,
          notificationDefaults: form.notificationDefaults,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", body.error ?? "Could not save settings.");
        return;
      }
      flash("saved", "Settings saved");
    } catch {
      flash("error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  const s = form.scheduledNotifications;

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Automation"
        title="Scheduled notifications"
        description="Worker-driven timed notification jobs and default delivery channels."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ECard className="p-6">
          <EToggle
            checked={s.reminder24hEnabled}
            onChange={(v) => setSched("reminder24hEnabled", v)}
            disabled={readOnly}
            label="24-hour reminder emails"
            description="Sends the scheduled email reminder flow based on the reminder hours."
          />
        </ECard>
        <ECard className="p-6">
          <EToggle
            checked={s.reminder2hEnabled}
            onChange={(v) => setSched("reminder2hEnabled", v)}
            disabled={readOnly}
            label="2-hour reminder SMS"
            description="Sends the scheduled SMS reminder flow based on the reminder hours."
          />
        </ECard>

        <ECard className="p-6">
          <div className="space-y-4">
            <EToggle
              checked={s.tomorrowPrepEnabled}
              onChange={(v) => setSched("tomorrowPrepEnabled", v)}
              disabled={readOnly}
              label="Tomorrow prep summaries"
              description="Cleaner, laundry, and admin tomorrow-prep notifications with critical stock alerts."
            />
            <EField label="Tomorrow prep send time">
              <EInput
                type="time"
                value={s.tomorrowPrepTime}
                onChange={(e) => setSched("tomorrowPrepTime", e.target.value || "17:00")}
                disabled={readOnly}
              />
            </EField>
          </div>
        </ECard>

        <ECard className="p-6">
          <div className="space-y-4">
            <EToggle
              checked={s.stockAlertsEnabled}
              onChange={(v) => setSched("stockAlertsEnabled", v)}
              disabled={readOnly}
              label="Critical stock alert emails"
              description="Daily admin low-stock alert using the inventory reorder thresholds."
            />
            <EField label="Stock alert send time">
              <EInput
                type="time"
                value={s.stockAlertsTime}
                onChange={(e) => setSched("stockAlertsTime", e.target.value || "07:00")}
                disabled={readOnly}
              />
            </EField>
          </div>
        </ECard>

        <ECard className="p-6">
          <div className="space-y-4">
            <EToggle
              checked={s.adminAttentionSummaryEnabled}
              onChange={(v) => setSched("adminAttentionSummaryEnabled", v)}
              disabled={readOnly}
              label="Daily admin attention summary"
              description="Daily email + SMS summary of approvals, unassigned jobs, cases, and flagged work."
            />
            <EField label="Admin summary send time">
              <EInput
                type="time"
                value={s.adminAttentionSummaryTime}
                onChange={(e) => setSched("adminAttentionSummaryTime", e.target.value || "08:00")}
                disabled={readOnly}
              />
            </EField>
          </div>
        </ECard>

        <ECard className="p-6">
          <div className="space-y-4">
            <EToggle
              checked={s.autoApproveLaundrySyncDrafts}
              onChange={(v) => setSched("autoApproveLaundrySyncDrafts", v)}
              disabled={readOnly}
              label="Auto-approve sync laundry drafts"
              description="When iCal sync changes future laundry schedules, approve and publish the draft automatically."
            />
            <EField
              label="Laundry future notification horizon (days ahead)"
              hint="Limit sync-driven laundry update emails/SMS to bookings within the next set number of days."
            >
              <EInput
                type="number"
                min={1}
                max={120}
                value={s.laundrySyncNotificationHorizonDays}
                onChange={(e) =>
                  setSched(
                    "laundrySyncNotificationHorizonDays",
                    Number(e.target.value || s.laundrySyncNotificationHorizonDays)
                  )
                }
                disabled={readOnly}
              />
            </EField>
          </div>
        </ECard>
      </div>

      <ESectionHeading
        eyebrow="Defaults"
        title="Notification defaults"
        description="Default delivery channels for new users and untouched preferences."
      />

      <ECard className="p-6">
        <div className="space-y-3">
          {Object.entries(form.notificationDefaults.categories).map(([category, channels]) => (
            <div
              key={category}
              className="grid items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4 sm:grid-cols-4"
            >
              <p className="text-[0.875rem] font-medium capitalize">{category}</p>
              {CHANNELS.map((channel) => (
                <div
                  key={`${category}-${channel}`}
                  className="flex items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-3 py-2"
                >
                  <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-text-secondary))]">
                    {channel}
                  </span>
                  <EToggle
                    checked={Boolean(channels?.[channel])}
                    onChange={(v) => setChannel(category, channel, v)}
                    disabled={readOnly}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </ECard>

      <div className="flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        {!readOnly ? (
          <EButton onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </EButton>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Read-only — administrator access required to edit.</p>
        )}
      </div>
    </div>
  );
}
