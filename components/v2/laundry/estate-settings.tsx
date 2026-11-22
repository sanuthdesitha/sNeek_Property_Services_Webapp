"use client";

/**
 * Estate-native settings for the v2 laundry portal. Zero live-component imports —
 * built from v2 primitives + fields. Notifications: the shared personal switches
 *   GET/PATCH /api/me/notification-switches (topics included; the older
 *   /api/notifications/preferences stays for classic pages)
 * Appearance (theme) is a client-only preference persisted in localStorage and
 * applied to the document, matching the Estate profile theme control.
 */
import * as React from "react";
import { Moon, Palette, Sun } from "lucide-react";
import {
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { EPasskeySection } from "@/components/v2/shared/passkey-section";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PersonalSwitchesPanel } from "@/components/v2/notifications/personal-switches-panel";

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
      {/* Every notification that can reach you, per transport (the office sees the same switches). */}
      <PersonalSwitchesPanel source={{ kind: "self" }} intro="Choose which notifications reach you and how. The office sees these switches and can change them for you." />
      <AppearanceSection />
      {/* Biometric sign-in devices (WebAuthn) — parity with v1 ProfileSettings. */}
      <EPasskeySection />
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
