"use client";

/**
 * Estate client settings — notification preferences + appearance. Same
 * endpoints as the profile page's comms/theme controls:
 *   PATCH /api/me/client-notification-preferences   { ...comms }
 *   POST  /api/me/preferences                        { themePreference }
 * Theme applies live via the shared ThemeProvider hook. Styled purely with
 * `--e-*` tokens — no v1 UI imports.
 */
import * as React from "react";
import { Loader2, Mail, MessageSquare, Monitor, Moon, Sun } from "lucide-react";
import { ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";
import { ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { EInlineNotice } from "@/components/v2/client/fields";
import { useTheme, type ThemePreference } from "@/lib/theme/context";
import { cn } from "@/lib/utils";

export interface SettingsComms {
  notificationsEnabled: boolean;
  notifyOnEnRoute: boolean;
  notifyOnJobStart: boolean;
  notifyOnJobComplete: boolean;
  preferredChannel: "EMAIL" | "SMS" | "BOTH";
}

function SectionCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <ECard>
      <ECardBody className="space-y-4 p-6">
        <div>
          <EEyebrow>{eyebrow}</EEyebrow>
          <h2 className="e-display-sm mt-1">{title}</h2>
          {description ? (
            <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{description}</p>
          ) : null}
        </div>
        {children}
      </ECardBody>
    </ECard>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5",
        disabled && "opacity-55"
      )}
    >
      <div className="min-w-0">
        <p className="text-[0.875rem]">{label}</p>
        {description ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{description}</p>
        ) : null}
      </div>
      <ESwitch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ClientSettingsPanel({ comms }: { comms: SettingsComms }) {
  const { preference, setPreference } = useTheme();
  const [pref, setPref] = React.useState<SettingsComms>(comms);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  function flashSaved() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  async function patchComms(updates: Partial<SettingsComms>) {
    setError(null);
    setSaving(true);
    const previous = pref;
    setPref((prev) => ({ ...prev, ...updates }));
    try {
      const res = await fetch("/api/me/client-notification-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPref(previous);
        setError(body.error || `Could not save (${res.status}).`);
        return;
      }
      flashSaved();
    } catch {
      setPref(previous);
      setError("Could not save your preferences.");
    } finally {
      setSaving(false);
    }
  }

  async function applyTheme(next: ThemePreference) {
    setPreference(next);
    setError(null);
    try {
      await fetch("/api/me/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themePreference: next }),
      });
      flashSaved();
    } catch {
      // Theme still applies locally even if persistence fails.
    }
  }

  const notificationsOff = !pref.notificationsEnabled;

  return (
    <div className="space-y-6">
      {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}
      {saved && !error ? <EInlineNotice tone="success">Saved.</EInlineNotice> : null}

      <SectionCard
        eyebrow="Notifications"
        title="Service updates"
        description="Choose which service events you hear about and how we reach you."
      >
        <div className="space-y-2.5">
          <ToggleRow
            label="Enable notifications"
            description="Turn all service notifications on or off."
            checked={pref.notificationsEnabled}
            onChange={(v) => patchComms({ notificationsEnabled: v })}
          />
          <ToggleRow
            label="Cleaner en route"
            description="When your cleaner is on the way."
            checked={pref.notifyOnEnRoute}
            disabled={notificationsOff}
            onChange={(v) => patchComms({ notifyOnEnRoute: v })}
          />
          <ToggleRow
            label="Job started"
            description="When a service begins at your property."
            checked={pref.notifyOnJobStart}
            disabled={notificationsOff}
            onChange={(v) => patchComms({ notifyOnJobStart: v })}
          />
          <ToggleRow
            label="Job completed"
            description="When a service is finished and a report is ready."
            checked={pref.notifyOnJobComplete}
            disabled={notificationsOff}
            onChange={(v) => patchComms({ notifyOnJobComplete: v })}
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-muted-foreground))]">
            Preferred channel
          </p>
          <ESelect
            value={pref.preferredChannel}
            disabled={notificationsOff || saving}
            onChange={(e) =>
              patchComms({ preferredChannel: e.target.value as SettingsComms["preferredChannel"] })
            }
          >
            <option value="EMAIL">Email</option>
            <option value="SMS">SMS</option>
            <option value="BOTH">Email &amp; SMS</option>
          </ESelect>
          <p className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {pref.preferredChannel === "SMS" ? (
              <MessageSquare className="h-3.5 w-3.5" />
            ) : pref.preferredChannel === "BOTH" ? (
              <Mail className="h-3.5 w-3.5" />
            ) : (
              <Mail className="h-3.5 w-3.5" />
            )}
            {pref.preferredChannel === "BOTH"
              ? "You will receive both email and text updates."
              : pref.preferredChannel === "SMS"
                ? "You will receive text-message updates."
                : "You will receive email updates."}
          </p>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Appearance"
        title="Theme"
        description="Choose how the portal looks. System follows your device setting."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {THEMES.map((t) => {
            const Icon = t.icon;
            const active = preference === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => applyTheme(t.value)}
                className={cn(
                  "flex items-center gap-3 rounded-[var(--e-radius)] border px-4 py-3 text-left transition-colors duration-[160ms]",
                  active
                    ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] shadow-[var(--e-elevation-1)]"
                    : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]"
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border",
                    active
                      ? "border-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-ink))]"
                      : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))]"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-[0.875rem] font-medium">{t.label}</span>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {saving ? (
        <p className="flex items-center gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
        </p>
      ) : null}
    </div>
  );
}
