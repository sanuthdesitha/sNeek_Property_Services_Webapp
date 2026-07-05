"use client";

/**
 * ESTATE — Settings › Overview.
 * Read-only project overview mirroring v1's SettingsWorkspace "overview" tab
 * (company / project name / app URL / timezone / accounts email / GST flag).
 * Self-fetches AppSettings from GET /api/admin/settings. Prop-light: drops in
 * as <OverviewSection />. Native Estate styling only (--e-* tokens).
 */
import * as React from "react";
import { Building2 } from "lucide-react";
import type { AppSettings } from "@/lib/settings";
import { ECard, ECardHeader, ECardTitle, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
      <EEyebrow className="text-[0.625rem]">{label}</EEyebrow>
      <p className="mt-1 text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">{value}</p>
    </div>
  );
}

export function OverviewSection(_: { isAdmin?: boolean } = {}) {
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load settings.");
        return res.json();
      })
      .then((data: AppSettings) => {
        if (!cancelled) setSettings(data);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? "Could not load settings.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ECard>
      <ECardHeader className="flex-row items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))] [&>svg]:h-4 [&>svg]:w-4">
          <Building2 />
        </span>
        <div>
          <EEyebrow>Project</EEyebrow>
          <ECardTitle className="text-[1.05rem]">Overview</ECardTitle>
        </div>
      </ECardHeader>
      <ECardBody>
        {error ? (
          <p className="text-[0.875rem] text-[hsl(var(--e-danger))]">{error}</p>
        ) : settings === null ? (
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading overview…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Company" value={settings.companyName || "—"} />
            <Field label="Project name" value={settings.projectName || "—"} />
            <Field
              label="Accounts email"
              value={settings.accountsEmail || "Not configured"}
            />
            <Field label="Timezone" value={settings.timezone || "—"} />
            <Field
              label="GST on new pricing"
              value={settings.pricing?.gstEnabled ? "Enabled" : "Disabled"}
            />
            <Field
              label="SMS provider"
              value={
                settings.smsProvider === "none"
                  ? "Disabled"
                  : settings.smsProvider === "twilio"
                    ? "Twilio"
                    : "Cellcast"
              }
            />
          </div>
        )}
      </ECardBody>
    </ECard>
  );
}

export default OverviewSection;
