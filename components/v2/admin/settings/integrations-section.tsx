"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Lock, ShieldCheck } from "lucide-react";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import { EField, EInput, EToggle, ESaveStatus, ESectionHeading, useSaveStatus } from "./estate-form";

type Creds = Record<string, string | boolean>;
type Locked = { databaseUrl?: boolean; nextAuthSecret?: boolean };

/** Secret fields that require the admin's password to change (mirrors server). */
const SENSITIVE_KEYS = new Set([
  "resendApiKey",
  "twilioAuthToken",
  "cellcastAppKey",
  "awsSecretAccessKey",
  "stripeSecretKey",
  "stripeWebhookSecret",
  "squareAccessToken",
  "paypalClientSecret",
  "xeroClientSecret",
  "googleMapsApiKey",
  "bootstrapAdminPassword",
  "vapidPrivateKey",
]);

type FieldDef = { key: string; label: string; type: "text" | "password" | "switch"; placeholder?: string };
type GroupDef = { id: string; title: string; description: string; link: string | null; fields: FieldDef[] };

const GROUPS: GroupDef[] = [
  {
    id: "email",
    title: "Email — Resend",
    description: "Outbound email delivery for notifications and invoices.",
    link: "https://resend.com",
    fields: [
      { key: "resendApiKey", label: "API key", type: "password", placeholder: "re_xxxxxx" },
      { key: "emailFrom", label: "From address", type: "text", placeholder: "noreply@yourdomain.com" },
    ],
  },
  {
    id: "sms-twilio",
    title: "SMS — Twilio",
    description: "Primary SMS provider for alerts and notifications.",
    link: "https://console.twilio.com",
    fields: [
      { key: "twilioAccountSid", label: "Account SID", type: "text", placeholder: "ACxxxx" },
      { key: "twilioAuthToken", label: "Auth token", type: "password" },
      { key: "twilioPhoneNumber", label: "Phone number", type: "text", placeholder: "+61400000000" },
    ],
  },
  {
    id: "sms-cellcast",
    title: "SMS — Cellcast",
    description: "Alternative SMS provider.",
    link: "https://cellcast.com.au",
    fields: [
      { key: "cellcastAppKey", label: "App key", type: "password", placeholder: "CELLCASTxxxx" },
      { key: "cellcastFrom", label: "Sender ID", type: "text", placeholder: "sNeek" },
    ],
  },
  {
    id: "storage",
    title: "Cloud storage — S3 / R2",
    description: "File uploads: photos, documents, and media.",
    link: "https://dash.cloudflare.com",
    fields: [
      { key: "s3BucketName", label: "Bucket name", type: "text", placeholder: "sneek-uploads" },
      { key: "s3Region", label: "Region", type: "text", placeholder: "auto" },
      { key: "s3Endpoint", label: "Endpoint URL", type: "text", placeholder: "https://<account>.r2.cloudflarestorage.com" },
      { key: "awsAccessKeyId", label: "Access key ID", type: "text" },
      { key: "awsSecretAccessKey", label: "Secret access key", type: "password" },
      { key: "s3PublicBaseUrl", label: "Public base URL", type: "text", placeholder: "https://pub-<hash>.r2.dev" },
    ],
  },
  {
    id: "stripe",
    title: "Stripe",
    description: "Client payments and cleaner payouts via Stripe Connect.",
    link: "https://dashboard.stripe.com",
    fields: [
      { key: "stripeSecretKey", label: "Secret key", type: "password", placeholder: "sk_live_xxxx" },
      { key: "stripeWebhookSecret", label: "Webhook secret", type: "password", placeholder: "whsec_xxxx" },
    ],
  },
  {
    id: "square",
    title: "Square",
    description: "Alternative payment gateway for client payments.",
    link: "https://developer.squareup.com",
    fields: [
      { key: "squareAccessToken", label: "Access token", type: "password", placeholder: "EAAAxxxx" },
      { key: "squareLocationId", label: "Location ID", type: "text", placeholder: "Lxxx" },
    ],
  },
  {
    id: "paypal",
    title: "PayPal",
    description: "PayPal Checkout for client payments.",
    link: "https://developer.paypal.com",
    fields: [
      { key: "paypalClientId", label: "Client ID", type: "text" },
      { key: "paypalClientSecret", label: "Client secret", type: "password" },
      { key: "paypalSandbox", label: "Sandbox mode", type: "switch" },
    ],
  },
  {
    id: "xero",
    title: "Xero accounting",
    description: "OAuth2 app credentials for invoice and contact sync.",
    link: "https://developer.xero.com/app/manage",
    fields: [
      { key: "xeroClientId", label: "Client ID", type: "text" },
      { key: "xeroClientSecret", label: "Client secret", type: "password" },
    ],
  },
  {
    id: "maps",
    title: "Google Maps",
    description: "Address autocomplete and map rendering.",
    link: "https://console.cloud.google.com",
    fields: [{ key: "googleMapsApiKey", label: "API key", type: "password", placeholder: "AIzaSyxxxx" }],
  },
  {
    id: "webpush",
    title: "Web push — VAPID",
    description: "Browser / PWA push notifications. Generate keys with: npx web-push generate-vapid-keys",
    link: null,
    fields: [
      { key: "vapidPublicKey", label: "Public key", type: "text", placeholder: "B…" },
      { key: "vapidPrivateKey", label: "Private key", type: "password" },
      { key: "vapidSubject", label: "Contact (email or URL)", type: "text", placeholder: "mailto:admin@yourdomain.com" },
    ],
  },
  {
    id: "bootstrap",
    title: "Bootstrap admin",
    description: "Initial admin account credentials used for first-time setup.",
    link: null,
    fields: [
      { key: "bootstrapAdminEmail", label: "Email", type: "text", placeholder: "admin@domain.com" },
      { key: "bootstrapAdminPassword", label: "Password", type: "password" },
      { key: "bootstrapAdminName", label: "Name", type: "text", placeholder: "Admin User" },
    ],
  },
];

/**
 * Integrations & API credentials — GET/PATCH /api/admin/integrations/credentials.
 * The API returns masked values only; edited keys are sent on save, and any
 * sensitive change is confirmed with the admin's account password (`_password`).
 */
export function IntegrationsSection() {
  const [credentials, setCredentials] = useState<Creds>({});
  const [masked, setMasked] = useState<Creds>({});
  const [locked, setLocked] = useState<Locked>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [adminPassword, setAdminPassword] = useState("");
  const { status, flash } = useSaveStatus();

  const sensitiveDirty = Array.from(dirty).some((k) => SENSITIVE_KEYS.has(k));

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/integrations/credentials");
      if (!res.ok) return;
      const data = await res.json();
      setCredentials(data.masked || {});
      setMasked(data.masked || {});
      setLocked(data.locked || {});
      setDirty(new Set());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  function change(key: string, value: string | boolean) {
    setCredentials((prev) => ({ ...prev, [key]: value }));
    setDirty((prev) => new Set(prev).add(key));
  }

  async function save() {
    if (sensitiveDirty && !adminPassword) {
      flash("error", "Enter your account password to change sensitive credentials.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string | boolean> = {};
      dirty.forEach((key) => {
        payload[key] = credentials[key] ?? "";
      });
      if (sensitiveDirty) payload._password = adminPassword;
      const res = await fetch("/api/admin/integrations/credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        flash("error", e.error ?? "Failed to save credentials.");
        return;
      }
      setAdminPassword("");
      flash("saved", "Credentials saved");
      await load();
    } catch {
      flash("error", "Failed to save credentials.");
    } finally {
      setSaving(false);
    }
  }

  function isConfigured(key: string): boolean {
    const val = credentials[key];
    if (typeof val === "boolean") return val;
    return typeof val === "string" && val.length > 0;
  }

  function groupStatus(group: GroupDef): "configured" | "partial" | "missing" {
    const configured = group.fields.filter((f) => isConfigured(f.key)).length;
    if (configured === 0) return "missing";
    if (configured === group.fields.length) return "configured";
    return "partial";
  }

  if (loading) {
    return (
      <p className="px-1 py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        Retrieving credentials…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Connected services"
        title="Integrations"
        description="Credentials for every external service. Secrets are masked once saved and never leave the server."
        actions={
          dirty.size > 0 ? (
            <EButton onClick={save} disabled={saving || (sensitiveDirty && !adminPassword)}>
              {saving ? "Saving…" : `Save ${dirty.size} change${dirty.size > 1 ? "s" : ""}`}
            </EButton>
          ) : undefined
        }
      />

      {GROUPS.map((group) => {
        const st = groupStatus(group);
        return (
          <ECard key={group.id} className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-[1rem] font-semibold tracking-[-0.01em]">{group.title}</h3>
                <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{group.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <EBadge tone={st === "configured" ? "success" : st === "partial" ? "warning" : "neutral"} soft>
                  {st === "configured" ? "Configured" : st === "partial" ? "Partial" : "Not configured"}
                </EBadge>
                {group.link ? (
                  <a
                    href={group.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[hsl(var(--e-text-faint))] transition-colors hover:text-[hsl(var(--e-gold-ink))]"
                    aria-label={`Open ${group.title} console`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {group.fields.map((field) => {
                const isDirty = dirty.has(field.key);
                const value = credentials[field.key] ?? "";
                const maskVal = masked[field.key] ?? "";

                if (field.type === "switch") {
                  return (
                    <EToggle
                      key={field.key}
                      checked={Boolean(value)}
                      onChange={(checked) => change(field.key, checked)}
                      label={field.label}
                      description={value ? "Sandbox mode enabled" : "Live mode"}
                    />
                  );
                }
                return (
                  <EField
                    key={field.key}
                    label={
                      <span className="flex items-center gap-2">
                        {field.label}
                        {SENSITIVE_KEYS.has(field.key) ? (
                          <Lock className="h-3 w-3 text-[hsl(var(--e-gold-ink))]" aria-label="Sensitive" />
                        ) : null}
                      </span>
                    }
                    htmlFor={`cred-${field.key}`}
                  >
                    <EInput
                      id={`cred-${field.key}`}
                      type={field.type === "password" ? "password" : "text"}
                      placeholder={field.placeholder}
                      value={isDirty ? String(value) : typeof maskVal === "string" ? maskVal : ""}
                      onChange={(e) => change(field.key, e.target.value)}
                      className={isDirty ? "border-[hsl(var(--e-gold))]" : undefined}
                    />
                  </EField>
                );
              })}
            </div>
          </ECard>
        );
      })}

      {/* System secrets — environment-managed, read-only by design. */}
      <ECard variant="ceremony" className="p-6">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
          <h3 className="text-[1rem] font-semibold tracking-[-0.01em]">System secrets</h3>
        </div>
        <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Read from the deployment environment and never editable here. Rotate them by updating the environment and redeploying.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { label: "Database URL", set: !!locked.databaseUrl },
            { label: "Auth session secret", set: !!locked.nextAuthSecret },
          ].map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-4 py-3"
            >
              <span className="flex items-center gap-2 text-[0.875rem] font-medium">
                <ShieldCheck className="h-3.5 w-3.5 text-[hsl(var(--e-text-faint))]" /> {row.label}
              </span>
              <EBadge tone={row.set ? "success" : "neutral"} soft>
                {row.set ? "Configured" : "Not set"}
              </EBadge>
            </div>
          ))}
        </div>
      </ECard>

      {dirty.size > 0 ? (
        <div className="sticky bottom-4 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface)/0.96)] p-5 shadow-[var(--e-elevation-2)] backdrop-blur">
          {sensitiveDirty ? (
            <div className="mb-4 max-w-sm">
              <EField
                label="Confirm your account password"
                htmlFor="cred-password"
                hint="You are changing a sensitive credential — re-enter your password to confirm."
              >
                <EInput
                  id="cred-password"
                  type="password"
                  autoComplete="current-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Your account password"
                />
              </EField>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {dirty.size} unsaved change{dirty.size > 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-3">
              <ESaveStatus status={status} />
              <EButton onClick={save} disabled={saving || (sensitiveDirty && !adminPassword)}>
                {saving ? "Saving…" : "Save all changes"}
              </EButton>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <ESaveStatus status={status} />
        </div>
      )}
    </div>
  );
}
