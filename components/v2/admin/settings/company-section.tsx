"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  EToggle,
  ESaveStatus,
  ESectionHeading,
  useSaveStatus,
} from "./estate-form";

export type CompanySettings = {
  companyName: string;
  projectName: string;
  logoUrl: string;
  reportLogoUrl: string;
  accountsEmail: string;
  timezone: string;
  gstEnabled: boolean;
  quoteDefaultEmailSubject: string;
  quoteDefaultValidityDays: number;
};

/**
 * Company & brand — the identity fields of AppSettings, saved via the same
 * partial PATCH /api/admin/settings the v1 editor uses.
 */
export function CompanySection({ initial, readOnly }: { initial: CompanySettings; readOnly: boolean }) {
  const [form, setForm] = useState<CompanySettings>(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "reportLogo" | null>(null);
  const { status, flash } = useSaveStatus();
  const logoInput = useRef<HTMLInputElement>(null);
  const reportLogoInput = useRef<HTMLInputElement>(null);

  function set<K extends keyof CompanySettings>(key: K, value: CompanySettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName,
          projectName: form.projectName,
          logoUrl: form.logoUrl,
          reportLogoUrl: form.reportLogoUrl,
          accountsEmail: form.accountsEmail,
          timezone: form.timezone,
          quoteDefaultEmailSubject: form.quoteDefaultEmailSubject,
          quoteDefaultValidityDays: form.quoteDefaultValidityDays,
          pricing: { gstEnabled: form.gstEnabled },
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

  async function upload(kind: "logo" | "reportLogo", file: File) {
    if (readOnly) return;
    setUploading(kind);
    try {
      const data = new FormData();
      data.append("file", file);
      data.append("folder", "branding");
      const res = await fetch("/api/uploads/direct", { method: "POST", body: data });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) {
        flash("error", body.error ?? "Logo upload failed.");
        return;
      }
      set(kind === "logo" ? "logoUrl" : "reportLogoUrl", body.url);
      flash("saved", "Logo uploaded — remember to save");
    } catch {
      flash("error", "Logo upload failed.");
    } finally {
      setUploading(null);
    }
  }

  function logoTile(kind: "logo" | "reportLogo") {
    const url = kind === "logo" ? form.logoUrl : form.reportLogoUrl;
    const ref = kind === "logo" ? logoInput : reportLogoInput;
    return (
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-[0.625rem] uppercase tracking-[0.14em] text-[hsl(var(--e-text-faint))]">None</span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <EInput
            value={url}
            onChange={(e) => set(kind === "logo" ? "logoUrl" : "reportLogoUrl", e.target.value)}
            placeholder="https://…"
            disabled={readOnly}
          />
          <input
            ref={ref}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(kind, file);
              e.target.value = "";
            }}
          />
          {!readOnly ? (
            <EButton variant="ghost" size="sm" onClick={() => ref.current?.click()} disabled={uploading !== null}>
              <UploadCloud className="h-3.5 w-3.5" />
              {uploading === kind ? "Uploading…" : "Upload image"}
            </EButton>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Identity"
        title="Company & brand"
        description="The name, marks, and defaults every document and portal inherits."
      />

      <ECard className="p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <EField label="Company name" htmlFor="company-name">
            <EInput
              id="company-name"
              value={form.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              disabled={readOnly}
            />
          </EField>
          <EField label="Project name" htmlFor="project-name" hint="Internal product name shown in portal chrome.">
            <EInput
              id="project-name"
              value={form.projectName}
              onChange={(e) => set("projectName", e.target.value)}
              disabled={readOnly}
            />
          </EField>
          <EField label="Accounts email" htmlFor="accounts-email">
            <EInput
              id="accounts-email"
              type="email"
              value={form.accountsEmail}
              onChange={(e) => set("accountsEmail", e.target.value)}
              disabled={readOnly}
            />
          </EField>
          <EField label="Timezone" htmlFor="timezone" hint="IANA identifier, e.g. Australia/Sydney.">
            <EInput
              id="timezone"
              value={form.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              placeholder="Australia/Sydney"
              disabled={readOnly}
            />
          </EField>
        </div>
      </ECard>

      <ECard className="p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <EField label="Primary logo" hint="Shown across the portals and public site.">
            {logoTile("logo")}
          </EField>
          <EField label="Report logo" hint="Optional light variant used on PDF reports and invoices; falls back to the primary logo.">
            {logoTile("reportLogo")}
          </EField>
        </div>
      </ECard>

      <ECard className="p-6">
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <EField label="Quote email subject" htmlFor="quote-subject">
              <EInput
                id="quote-subject"
                value={form.quoteDefaultEmailSubject}
                onChange={(e) => set("quoteDefaultEmailSubject", e.target.value)}
                disabled={readOnly}
              />
            </EField>
            <EField label="Quote validity (days)" htmlFor="quote-validity">
              <EInput
                id="quote-validity"
                type="number"
                min={1}
                max={90}
                value={form.quoteDefaultValidityDays}
                onChange={(e) => set("quoteDefaultValidityDays", Number(e.target.value || 14))}
                disabled={readOnly}
              />
            </EField>
          </div>
          <EToggle
            checked={form.gstEnabled}
            onChange={(v) => set("gstEnabled", v)}
            disabled={readOnly}
            label="GST on new pricing"
            description="Applies 10% GST to newly generated quotes and invoices by default."
          />
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
