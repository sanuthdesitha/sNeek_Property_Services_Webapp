"use client";

/**
 * Estate-native settings for the v2 laundry portal. Zero live-component imports —
 * built from v2 primitives + fields. Hits the same endpoints as the live app:
 *   GET/PATCH /api/notifications/preferences  { <category>: { web, email, sms } }
 * Appearance (theme) is a client-only preference persisted in localStorage and
 * applied to the document, matching the Estate profile theme control.
 */
import * as React from "react";
import { Loader2, Moon, Palette, Sun } from "lucide-react";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { ESwitch } from "@/components/v2/cleaner/fields";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
    const next: Prefs = {
      ...prefs,
      [category]: { ...prefs[category], [channel]: value },
    };
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
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {category} updates.
                </p>
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

type Theme = "light" | "dark" | "public";

function AppearanceSection() {
  const [theme, setTheme] = React.useState<Theme>("light");

  React.useEffect(() => {
    const saved = localStorage.getItem("portal-theme-override") as Theme | null;
    if (saved === "dark" || saved === "light" || saved === "public") setTheme(saved);
  }, []);

  const options: Array<{ value: Theme; label: string; description: string; Icon: typeof Sun }> = [
    { value: "light", label: "Light", description: "Warm ivory — the Estate default", Icon: Sun },
    { value: "dark", label: "Dark", description: "Low-light charcoal & teal", Icon: Moon },
    { value: "public", label: "Match site", description: "Follow the public brand theme", Icon: Palette },
  ];

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Appearance</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Saved to this browser only.
        </p>
      </ECardHeader>
      <ECardBody>
        <div className="grid gap-3 sm:grid-cols-3">
          {options.map(({ value, label, description, Icon }) => {
            const active = theme === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setTheme(value);
                  localStorage.setItem("portal-theme-override", value);
                  window.dispatchEvent(
                    new StorageEvent("storage", { key: "portal-theme-override", newValue: value })
                  );
                  toast({ title: `Theme set to ${label}` });
                }}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-[var(--e-radius-lg)] border-2 p-4 text-left transition-colors",
                  active
                    ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]"
                    : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]"
                )}
              >
                <Icon
                  className="h-5 w-5"
                  style={{ color: active ? "hsl(var(--e-gold-ink))" : "hsl(var(--e-muted-foreground))" }}
                />
                <span className="text-[0.875rem] font-semibold">{label}</span>
                <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{description}</span>
              </button>
            );
          })}
        </div>
      </ECardBody>
    </ECard>
  );
}

export function EstateSettings() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <NotificationSection />
      <AppearanceSection />
      <ECard>
        <ECardBody className="pt-6">
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Looking for your contact details, banking, password or two-step verification? Those live
            on your{" "}
            <a href="/v2/laundry/profile" className="font-medium text-[hsl(var(--e-gold-ink))] underline underline-offset-2">
              profile
            </a>
            .
          </p>
        </ECardBody>
      </ECard>
    </div>
  );
}
