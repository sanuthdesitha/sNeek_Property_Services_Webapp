"use client";

/**
 * Estate client settings — the account's notification switches + appearance.
 *   GET/PATCH /api/me/notification-switches   (lib/notifications/personal; the
 *     older /api/me/client-notification-preferences stays for the classic page)
 *   POST  /api/me/preferences                  { themePreference }
 * Theme applies live via the shared ThemeProvider hook. Styled purely with
 * `--e-*` tokens — no v1 UI imports.
 */
import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";
import { EInlineNotice } from "@/components/v2/client/fields";
import { PersonalSwitchesPanel } from "@/components/v2/notifications/personal-switches-panel";
import { useTheme, type ThemePreference } from "@/lib/theme/context";
import { cn } from "@/lib/utils";

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

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ClientSettingsPanel() {
  const { preference, setPreference } = useTheme();
  const [themeSaved, setThemeSaved] = React.useState(false);

  async function applyTheme(next: ThemePreference) {
    setPreference(next);
    try {
      await fetch("/api/me/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themePreference: next }),
      });
      setThemeSaved(true);
      window.setTimeout(() => setThemeSaved(false), 1500);
    } catch {
      // Theme still applies locally even if persistence fails.
    }
  }

  return (
    <div className="space-y-6">
      {/* The account's notification switches: the same ones the office sees and can change. */}
      <PersonalSwitchesPanel
        source={{ kind: "self" }}
        title="Service updates"
        intro="Choose which notifications you get and how we reach you. The office sees these switches and can change them for you if you ask."
      />

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

      {themeSaved ? <EInlineNotice tone="success">Saved.</EInlineNotice> : null}
    </div>
  );
}
