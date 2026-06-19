"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Mail,
  MessageSquare,
  Database,
  CreditCard,
  MapPin,
  Users,
  Bell,
  Lock,
  ShieldCheck,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

type Creds = Record<string, string | boolean>;
type Masked = Record<string, string | boolean>;
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

const SECTIONS = [
  {
    id: "email",
    title: "Email (Resend)",
    description: "Outbound email delivery for notifications and invoices.",
    icon: Mail,
    link: "https://resend.com",
    fields: [
      { key: "resendApiKey", label: "API Key", type: "password" as const, placeholder: "re_xxxxxx" },
      { key: "emailFrom", label: "From Address", type: "text" as const, placeholder: "noreply@yourdomain.com" },
    ],
  },
  {
    id: "sms-twilio",
    title: "SMS – Twilio",
    description: "Primary SMS provider for alerts and notifications.",
    icon: MessageSquare,
    link: "https://console.twilio.com",
    fields: [
      { key: "twilioAccountSid", label: "Account SID", type: "text" as const, placeholder: "ACxxxx" },
      { key: "twilioAuthToken", label: "Auth Token", type: "password" as const, placeholder: "••••" },
      { key: "twilioPhoneNumber", label: "Phone Number", type: "text" as const, placeholder: "+61400000000" },
    ],
  },
  {
    id: "sms-cellcast",
    title: "SMS – Cellcast",
    description: "Alternative SMS provider.",
    icon: MessageSquare,
    link: "https://cellcast.com.au",
    fields: [
      { key: "cellcastAppKey", label: "App Key", type: "password" as const, placeholder: "CELLCASTxxxx" },
      { key: "cellcastFrom", label: "Sender ID", type: "text" as const, placeholder: "sNeek" },
    ],
  },
  {
    id: "storage",
    title: "Cloud Storage (S3 / R2)",
    description: "File uploads: photos, documents, and media.",
    icon: Database,
    link: "https://dash.cloudflare.com",
    fields: [
      { key: "s3BucketName", label: "Bucket Name", type: "text" as const, placeholder: "sneek-uploads" },
      { key: "s3Region", label: "Region", type: "text" as const, placeholder: "auto" },
      { key: "s3Endpoint", label: "Endpoint URL", type: "text" as const, placeholder: "https://<account>.r2.cloudflarestorage.com" },
      { key: "awsAccessKeyId", label: "Access Key ID", type: "text" as const, placeholder: "" },
      { key: "awsSecretAccessKey", label: "Secret Access Key", type: "password" as const, placeholder: "" },
      { key: "s3PublicBaseUrl", label: "Public Base URL", type: "text" as const, placeholder: "https://pub-<hash>.r2.dev" },
    ],
  },
  {
    id: "stripe",
    title: "Stripe",
    description: "Client payments and cleaner payouts via Stripe Connect.",
    icon: CreditCard,
    link: "https://dashboard.stripe.com",
    fields: [
      { key: "stripeSecretKey", label: "Secret Key", type: "password" as const, placeholder: "sk_live_xxxx" },
      { key: "stripeWebhookSecret", label: "Webhook Secret", type: "password" as const, placeholder: "whsec_xxxx" },
    ],
  },
  {
    id: "square",
    title: "Square",
    description: "Alternative payment gateway for client payments.",
    icon: CreditCard,
    link: "https://developer.squareup.com",
    fields: [
      { key: "squareAccessToken", label: "Access Token", type: "password" as const, placeholder: "EAAAxxxx" },
      { key: "squareLocationId", label: "Location ID", type: "text" as const, placeholder: "Lxxx" },
    ],
  },
  {
    id: "paypal",
    title: "PayPal",
    description: "PayPal Checkout for client payments.",
    icon: CreditCard,
    link: "https://developer.paypal.com",
    fields: [
      { key: "paypalClientId", label: "Client ID", type: "text" as const, placeholder: "" },
      { key: "paypalClientSecret", label: "Client Secret", type: "password" as const, placeholder: "" },
      { key: "paypalSandbox", label: "Sandbox Mode", type: "switch" as const, placeholder: "" },
    ],
  },
  {
    id: "xero",
    title: "Xero Accounting",
    description: "OAuth2 app credentials for invoice/contact sync.",
    icon: CreditCard,
    link: "https://developer.xero.com/app/manage",
    fields: [
      { key: "xeroClientId", label: "Client ID", type: "text" as const, placeholder: "" },
      { key: "xeroClientSecret", label: "Client Secret", type: "password" as const, placeholder: "" },
    ],
  },
  {
    id: "maps",
    title: "Google Maps",
    description: "Address autocomplete and map rendering.",
    icon: MapPin,
    link: "https://console.cloud.google.com",
    fields: [
      { key: "googleMapsApiKey", label: "API Key", type: "password" as const, placeholder: "AIzaSyxxxx" },
    ],
  },
  {
    id: "webpush",
    title: "Web Push (VAPID)",
    description: "Browser / PWA push notifications. Generate keys with: npx web-push generate-vapid-keys",
    icon: Bell,
    link: null,
    fields: [
      { key: "vapidPublicKey", label: "Public Key", type: "text" as const, placeholder: "B…" },
      { key: "vapidPrivateKey", label: "Private Key", type: "password" as const, placeholder: "••••" },
      { key: "vapidSubject", label: "Contact (email or URL)", type: "text" as const, placeholder: "mailto:admin@yourdomain.com" },
    ],
  },
  {
    id: "bootstrap",
    title: "Bootstrap Admin",
    description: "Initial admin account credentials (used for first-time setup).",
    icon: Users,
    link: null,
    fields: [
      { key: "bootstrapAdminEmail", label: "Email", type: "text" as const, placeholder: "admin@domain.com" },
      { key: "bootstrapAdminPassword", label: "Password", type: "password" as const, placeholder: "" },
      { key: "bootstrapAdminName", label: "Name", type: "text" as const, placeholder: "Admin User" },
    ],
  },
];

export function IntegrationsSettings() {
  const [credentials, setCredentials] = useState<Creds>({});
  const [masked, setMasked] = useState<Masked>({});
  const [locked, setLocked] = useState<Locked>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [adminPassword, setAdminPassword] = useState("");
  useEffect(() => { loadCredentials(); }, []);

  // Whether the pending changes touch any secret → an admin password is needed.
  const sensitiveDirty = Array.from(dirty).some((k) => SENSITIVE_KEYS.has(k));

  async function loadCredentials() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/integrations/credentials");
      if (!res.ok) return;
      const data = await res.json();
      // The API only returns masked values now (real secrets never leave the
      // server). Edited fields are sent on save; untouched masked values are
      // preserved server-side via bullet-detection.
      setCredentials(data.masked || {});
      setMasked(data.masked || {});
      setLocked(data.locked || {});
      setDirty(new Set());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  function handleChange(key: string, value: string | boolean) {
    setCredentials((prev) => ({ ...prev, [key]: value }));
    setDirty((prev) => new Set(prev).add(key));
  }

  async function handleSave() {
    if (sensitiveDirty && !adminPassword) {
      alert("Enter your account password to change sensitive credentials.");
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
        alert(e.error || "Failed to save credentials");
        return;
      }
      setAdminPassword("");
      setDirty(new Set());
      await loadCredentials();
    } catch {
      alert("Failed to save credentials");
    } finally {
      setSaving(false);
    }
  }

  function isFieldConfigured(key: string): boolean {
    const val = credentials[key];
    if (typeof val === "boolean") return val;
    return typeof val === "string" && val.length > 0;
  }

  function sectionStatus(section: typeof SECTIONS[0]): "configured" | "partial" | "missing" {
    const configured = section.fields.filter((f) => isFieldConfigured(f.key)).length;
    if (configured === 0) return "missing";
    if (configured === section.fields.length) return "configured";
    return "partial";
  }

  if (loading) {
    return <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading integration settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Integrations &amp; API Credentials</h3>
          <p className="text-sm text-muted-foreground">
            Configure all external service credentials. Sensitive values are masked after saving.
          </p>
        </div>
        {dirty.size > 0 && (
          <Button onClick={handleSave} disabled={saving || (sensitiveDirty && !adminPassword)}>
            {saving ? "Saving..." : `Save ${dirty.size} change${dirty.size > 1 ? "s" : ""}`}
          </Button>
        )}
      </div>

      {/* Credential sections */}
      {SECTIONS.map((section) => {
        const Icon = section.icon;
        const st = sectionStatus(section);
        return (
          <Card key={section.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{section.title}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={st === "configured" ? "success" : st === "partial" ? "outline" : "secondary"}
                    className="text-xs"
                  >
                    {st === "configured" ? (
                      <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Configured</span>
                    ) : st === "partial" ? (
                      <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Partial</span>
                    ) : (
                      "Not configured"
                    )}
                  </Badge>
                  {section.link && (
                    <a href={section.link} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {section.fields.map((field) => {
                  const value = credentials[field.key] ?? "";
                  const maskVal = masked[field.key] ?? "";
                  const isDirty = dirty.has(field.key);
                  const isConfigured = isFieldConfigured(field.key);

                  if (field.type === "switch") {
                    return (
                      <div key={field.key} className="flex items-center justify-between gap-4 rounded-lg border p-3">
                        <div>
                          <Label className="text-sm">{field.label}</Label>
                          <p className="text-xs text-muted-foreground">
                            {value ? "Sandbox mode enabled" : "Live mode"}
                          </p>
                        </div>
                        <Switch
                          checked={Boolean(value)}
                          onCheckedChange={(checked) => handleChange(field.key, checked)}
                        />
                      </div>
                    );
                  }

                  return (
                    <div key={field.key} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">{field.label}</Label>
                        {isConfigured && !isDirty && (
                          <Badge variant="outline" className="text-[10px]">
                            {typeof maskVal === "string" && maskVal ? maskVal : "Set"}
                          </Badge>
                        )}
                      </div>
                      <Input
                        type={field.type === "password" ? "password" : "text"}
                        placeholder={field.placeholder}
                        value={isDirty ? String(value) : (typeof maskVal === "string" ? maskVal : "")}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        className={isDirty ? "border-primary/50" : ""}
                      />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* System secrets — read-only, managed in the environment, never editable
          or deletable from the web app. */}
      <Card className="border-amber-200/60 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/10">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-600" />
            <CardTitle className="text-base">System secrets (locked)</CardTitle>
          </div>
          <CardDescription>
            These are read from the deployment environment and cannot be changed or
            deleted here — by design. To rotate them, update the environment and redeploy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: "Database URL", set: !!locked.databaseUrl },
              { label: "Auth session secret", set: !!locked.nextAuthSecret },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-lg border bg-background px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">{row.label}</span>
                </div>
                <Badge variant={row.set ? "success" : "secondary"} className="text-xs">
                  {row.set ? (
                    <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Configured</span>
                  ) : (
                    "Not set"
                  )}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Save bar at bottom */}
      {dirty.size > 0 && (
        <div className="sticky bottom-4 space-y-3 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur-sm">
          {sensitiveDirty && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
              <Label className="flex items-center gap-1.5 text-sm">
                <Lock className="h-3.5 w-3.5" /> Confirm your account password
              </Label>
              <p className="text-xs text-muted-foreground">
                You&apos;re changing a sensitive credential, so re-enter your password to confirm.
              </p>
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Your account password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="max-w-sm"
              />
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {dirty.size} unsaved change{dirty.size > 1 ? "s" : ""}
            </p>
            <Button onClick={handleSave} disabled={saving || (sensitiveDirty && !adminPassword)}>
              {saving ? "Saving..." : "Save All Changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
