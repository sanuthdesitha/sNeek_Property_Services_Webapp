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
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

type Creds = Record<string, string | boolean>;
type Masked = Record<string, string | boolean>;

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ xeroConnected: boolean }>({ xeroConnected: false });

  useEffect(() => { loadCredentials(); }, []);

  async function loadCredentials() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/integrations/credentials");
      if (!res.ok) return;
      const data = await res.json();
      setCredentials(data.credentials || {});
      setMasked(data.masked || {});
      setDirty(new Set());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function loadXeroStatus() {
    try {
      const res = await fetch("/api/xero/status");
      if (res.ok) {
        const data = await res.json();
        setStatus({ xeroConnected: data.connected ?? false });
      }
    } catch { /* ignore */ }
  }

  useEffect(() => { loadXeroStatus(); }, []);

  function handleChange(key: string, value: string | boolean) {
    setCredentials((prev) => ({ ...prev, [key]: value }));
    setDirty((prev) => new Set(prev).add(key));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, string | boolean> = {};
      dirty.forEach((key) => {
        payload[key] = credentials[key] ?? "";
      });
      const res = await fetch("/api/admin/integrations/credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json();
        alert(e.error || "Failed to save credentials");
        return;
      }
      setDirty(new Set());
      await loadCredentials();
      await loadXeroStatus();
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
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : `Save ${dirty.size} change${dirty.size > 1 ? "s" : ""}`}
          </Button>
        )}
      </div>

      {/* Xero connection status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Xero Accounting</CardTitle>
              <CardDescription>OAuth2 connection — invoices and contacts sync.</CardDescription>
            </div>
            <Badge variant={status.xeroConnected ? "success" : "secondary"} className="text-sm">
              {status.xeroConnected ? "Connected" : "Not connected"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Xero uses OAuth2 — no API keys needed here. Connect via the button below.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/admin/integrations/xero" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                Manage Xero Connection
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Payment gateways link */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Payment Gateways</CardTitle>
              <CardDescription>Manage Stripe, Square, and PayPal gateway instances.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            API credentials are configured below. Gateway instances (enable/disable, surcharge, priority) are managed separately.
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href="/admin/settings/payment-gateways" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              Manage Gateways
            </a>
          </Button>
        </CardContent>
      </Card>

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

      {/* Save bar at bottom */}
      {dirty.size > 0 && (
        <div className="sticky bottom-4 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {dirty.size} unsaved change{dirty.size > 1 ? "s" : ""}
            </p>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save All Changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
