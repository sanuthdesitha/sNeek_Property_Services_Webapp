"use client";

/**
 * ESTATE — Maintenance worker settings (native v2 port of the v1 ProfileSettings
 * mounted at app/maintenance/settings). Contact details, notification
 * preferences, appearance, password, and two-step verification for a maintenance
 * worker. Zero live (v1) UI imports — composed from the Estate v2 kit and the
 * shared EstateProfile (contact + password + 2FA).
 *
 * Endpoints (unchanged from v1):
 *   PATCH /api/me/profile                 (via EstateProfile ContactSection)
 *   POST  /api/me/preferences             (via EstateProfile PreferencesSection)
 *   POST  /api/me/password                (via EstateProfile PasswordSection)
 *   GET/POST/PUT/DELETE /api/auth/2fa/settings  (via EstateProfile TwoFactorSection)
 *   GET/PATCH /api/notifications/preferences    (NotificationSection below)
 */

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  ECard,
  ECardHeader,
  ECardTitle,
  ECardBody,
} from "@/components/v2/ui/primitives";
import { ESwitch } from "@/components/v2/cleaner/fields";
import { EstateProfile, type EstateProfileUser } from "@/components/v2/laundry/estate-profile";
import { EPasskeySection } from "@/components/v2/shared/passkey-section";
import { toast } from "@/hooks/use-toast";

type ChannelPrefs = { web: boolean; email: boolean; sms: boolean };
type Prefs = Record<string, ChannelPrefs>;

const CHANNELS: Array<keyof ChannelPrefs> = ["web", "email", "sms"];

function NotificationSection() {
  const [prefs, setPrefs] = React.useState<Prefs>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/notifications/preferences", { cache: "no-store" });
        if (res.ok) setPrefs(await res.json());
      } catch {
        /* non-fatal */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(next: Prefs) {
    setSaving(true);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not save", description: body?.error, variant: "destructive" });
        return;
      }
      setPrefs(body);
      toast({ title: "Notification preferences updated" });
    } finally {
      setSaving(false);
    }
  }

  function toggle(category: string, channel: keyof ChannelPrefs, value: boolean) {
    const next: Prefs = { ...prefs, [category]: { ...prefs[category], [channel]: value } };
    setPrefs(next);
    void save(next);
  }

  const categories = Object.entries(prefs);

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Notifications</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Choose how each kind of update reaches you.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-3">
        {loading ? (
          <p className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
          </p>
        ) : categories.length === 0 ? (
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No notification categories are available for your account.
          </p>
        ) : (
          categories.map(([category, pref]) => (
            <div
              key={category}
              className="grid items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 md:grid-cols-4"
            >
              <div>
                <p className="text-[0.875rem] font-medium capitalize">{category}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{category} updates.</p>
              </div>
              {CHANNELS.map((channel) => (
                <div
                  key={`${category}-${channel}`}
                  className="flex items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-1.5"
                >
                  <span className="text-[0.6875rem] font-[550] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">
                    {channel}
                  </span>
                  <ESwitch
                    aria-label={`${category} ${channel}`}
                    checked={Boolean(pref?.[channel])}
                    disabled={saving}
                    onCheckedChange={(v) => toggle(category, channel, v)}
                  />
                </div>
              ))}
            </div>
          ))
        )}
      </ECardBody>
    </ECard>
  );
}

export function MaintenanceSettings({
  user,
  editingEnabled = true,
  initialDensity,
  initialTheme,
}: {
  user: EstateProfileUser;
  editingEnabled?: boolean;
  initialDensity?: "COMPACT" | "DEFAULT" | "COMFORTABLE";
  initialTheme?: "LIGHT" | "DARK" | "SYSTEM";
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Contact + preferences (density/theme) + password + two-step verification */}
      <EstateProfile
        user={user}
        editingEnabled={editingEnabled}
        initialDensity={initialDensity}
        initialTheme={initialTheme}
      />
      {/* Notification channel matrix */}
      <NotificationSection />
      {/* Biometric sign-in devices (WebAuthn) — parity with v1 ProfileSettings. */}
      <EPasskeySection />
    </div>
  );
}
