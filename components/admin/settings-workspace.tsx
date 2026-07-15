"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Role } from "@prisma/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppSettings } from "@/lib/settings";

type SettingCategory =
  | "branding"
  | "operations"
  | "communications"
  | "finance"
  | "integrations"
  | "roles"
  | "display"
  | "system";

const CATEGORY_LABELS: Record<SettingCategory | "all", string> = {
  all: "All",
  branding: "Branding",
  operations: "Operations",
  communications: "Communications",
  finance: "Finance",
  integrations: "Integrations",
  roles: "Roles & Permissions",
  display: "Display",
  system: "System",
};

type SettingsSectionMeta = {
  value: string;
  label: string;
  category: SettingCategory;
  adminOnly?: boolean;
  keywords: string;
};

const SECTION_REGISTRY: SettingsSectionMeta[] = [
  { value: "editor", label: "Core settings", category: "operations", keywords: "company branding logo timezone gst pricing core" },
  { value: "overview", label: "Overview", category: "system", keywords: "overview project name app url timezone" },
  { value: "accountability", label: "Accountability", category: "operations", adminOnly: true, keywords: "accountability qa scoring deductions rating bonus streak rectification rework issue categories pattern gates quality" },
  { value: "integrations", label: "Integrations", category: "integrations", adminOnly: true, keywords: "stripe resend google maps hospitable api credentials" },
  { value: "ical-sync", label: "iCal Sync", category: "integrations", adminOnly: true, keywords: "ical calendar sync reservations airbnb hospitable property feed runs" },
  { value: "payment-gateways", label: "Payment Gateways", category: "finance", adminOnly: true, keywords: "stripe square paypal payments gateway" },
  { value: "xero", label: "Xero", category: "finance", adminOnly: true, keywords: "xero accounting invoice sync" },
  { value: "finance-notifications", label: "Finance Notifications", category: "communications", adminOnly: true, keywords: "finance invoice payment notification" },
  { value: "notifications", label: "Notification tools", category: "communications", keywords: "email sms twilio cellcast test notifications resend" },
  { value: "message-channels", label: "Message channels", category: "communications", adminOnly: true, keywords: "message channels audience email sms push masters kill switch outbound clients cleaners laundry maintenance qa staff public leads marketing gate" },
  { value: "pricebook", label: "Price book", category: "finance", adminOnly: true, keywords: "price book pricing rate" },
  { value: "audit", label: "Audit log", category: "system", adminOnly: true, keywords: "audit history changes log" },
  { value: "roles", label: "Roles", category: "roles", keywords: "roles permissions rbac access matrix" },
];

const SettingsEditor = dynamic(
  () => import("@/components/admin/settings-editor").then((mod) => mod.SettingsEditor),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading settings editor...</div> }
);
const AccountabilitySettingsEditor = dynamic(
  () => import("@/components/admin/accountability-settings").then((mod) => mod.AccountabilitySettingsEditor),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading accountability settings...</div> }
);
const PricebookEditor = dynamic(
  () => import("@/components/admin/pricebook-editor").then((mod) => mod.PricebookEditor),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading price book...</div> }
);
const SettingsAuditLog = dynamic(
  () => import("@/components/admin/settings-audit-log").then((mod) => mod.SettingsAuditLog),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading audit log...</div> }
);
const NotificationTestForm = dynamic(
  () => import("@/components/admin/notification-test-form").then((mod) => mod.NotificationTestForm),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading notification tools...</div> }
);
const NotificationAudienceSettings = dynamic(
  () => import("@/components/admin/notification-audience-settings").then((mod) => mod.NotificationAudienceSettings),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading message channels...</div> }
);
const ScheduledNotificationControls = dynamic(
  () => import("@/components/admin/scheduled-notification-controls").then((mod) => mod.ScheduledNotificationControls),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading scheduled tools...</div> }
);
const FinanceNotificationsSettings = dynamic(
  () => import("@/components/admin/finance-notifications-settings").then((mod) => mod.FinanceNotificationsSettings),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading finance notification settings...</div> }
);
const IntegrationsSettings = dynamic(
  () => import("@/components/admin/integrations-settings").then((mod) => mod.IntegrationsSettings),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading integration settings...</div> }
);
const IcalSyncOps = dynamic(
  () => import("@/components/admin/ical-sync-ops").then((mod) => mod.IcalSyncOps),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading iCal sync ops...</div> }
);
const PaymentGatewaysTab = dynamic(
  () => import("@/components/admin/payment-gateways-page").then((mod) => ({ default: mod.PaymentGatewaysPage })),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading payment gateways...</div> }
);
const XeroTab = dynamic(
  () => import("@/components/admin/xero-settings-tab").then((mod) => ({ default: mod.XeroSettingsTab })),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading Xero settings...</div> }
);

const ROLE_SUMMARY: Record<Role, string> = {
  [Role.ADMIN]: "Full platform access including settings and pricing",
  [Role.OPS_MANAGER]: "Jobs, QA, reports, clients, properties, and quotes",
  [Role.QA_INSPECTOR]: "Claimable QA queue, inspections, and feedback to cleaners",
  [Role.CLEANER]: "Assigned jobs, form submission, uploads, and time logs",
  [Role.CLIENT]: "Own properties and reports only",
  [Role.LAUNDRY]: "Laundry week schedule and ready queue",
  [Role.MAINTENANCE]: "Assigned repair jobs, access details, and on-site visit tracking",
};

type SettingsWorkspaceProps = {
  appSettings: AppSettings;
  cleaners: Array<{ id: string; name: string | null; email: string }>;
  isAdmin: boolean;
  sessionEmail: string;
  emailConfigured: boolean;
  twilioConfigured: boolean;
  cellcastConfigured: boolean;
  activeSmsProviderConfigured: boolean;
  configuredAppUrl: string;
  permissionRows: Array<{ permission: string; roles: string[] }>;
  defaultTab?: string;
};

export function SettingsWorkspace({
  appSettings,
  cleaners,
  isAdmin,
  sessionEmail,
  emailConfigured,
  twilioConfigured,
  cellcastConfigured,
  activeSmsProviderConfigured,
  configuredAppUrl,
  permissionRows,
  defaultTab,
}: SettingsWorkspaceProps) {
  const [tab, setTab] = useState(defaultTab ?? "editor");
  const [pricebookRows, setPricebookRows] = useState<any[] | null>(null);
  const [auditEntries, setAuditEntries] = useState<any[] | null>(null);
  const [category, setCategory] = useState<SettingCategory | "all">("all");
  const [query, setQuery] = useState("");

  const visibleSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SECTION_REGISTRY.filter((section) => {
      if (section.adminOnly && !isAdmin) return false;
      if (category !== "all" && section.category !== category) return false;
      if (q) {
        const haystack = `${section.label} ${section.keywords}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [category, query, isAdmin]);

  const visibleValues = useMemo(() => new Set(visibleSections.map((s) => s.value)), [visibleSections]);

  // Keep active tab valid relative to filter.
  useEffect(() => {
    if (!visibleValues.has(tab) && visibleSections[0]) {
      setTab(visibleSections[0].value);
    }
  }, [tab, visibleValues, visibleSections]);

  const categories: Array<SettingCategory | "all"> = [
    "all",
    "branding",
    "operations",
    "communications",
    "finance",
    "integrations",
    "roles",
    "display",
    "system",
  ];

  useEffect(() => {
    if (!isAdmin || tab !== "pricebook" || pricebookRows !== null) return;
    fetch("/api/admin/pricebook", { cache: "no-store" })
      .then((res) => res.json().catch(() => []))
      .then((rows) => setPricebookRows(Array.isArray(rows) ? rows : []))
      .catch(() => setPricebookRows([]));
  }, [isAdmin, tab, pricebookRows]);

  useEffect(() => {
    if (!isAdmin || tab !== "audit" || auditEntries !== null) return;
    fetch("/api/admin/settings/audit", { cache: "no-store" })
      .then((res) => res.json().catch(() => []))
      .then((rows) => setAuditEntries(Array.isArray(rows) ? rows : []))
      .catch(() => setAuditEntries([]));
  }, [isAdmin, tab, auditEntries]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                category === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
          {category === "display" ? (
            <Link
              href="/admin/settings/display"
              className="rounded-md border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              Open display settings ↗
            </Link>
          ) : null}
        </div>
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings..."
            className="pl-8"
          />
        </div>
      </div>

      {visibleSections.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No settings match this filter.
          </CardContent>
        </Card>
      ) : null}

    <Tabs value={tab} onValueChange={setTab} className="space-y-6">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
        {visibleValues.has("editor") ? <TabsTrigger value="editor">Core settings</TabsTrigger> : null}
        {visibleValues.has("overview") ? <TabsTrigger value="overview">Overview</TabsTrigger> : null}
        {isAdmin && visibleValues.has("accountability") ? <TabsTrigger value="accountability">Accountability</TabsTrigger> : null}
        {isAdmin && visibleValues.has("integrations") ? <TabsTrigger value="integrations">Integrations</TabsTrigger> : null}
        {isAdmin && visibleValues.has("ical-sync") ? <TabsTrigger value="ical-sync">iCal Sync</TabsTrigger> : null}
        {isAdmin && visibleValues.has("payment-gateways") ? <TabsTrigger value="payment-gateways">Payment Gateways</TabsTrigger> : null}
        {isAdmin && visibleValues.has("xero") ? <TabsTrigger value="xero">Xero</TabsTrigger> : null}
        {isAdmin && visibleValues.has("finance-notifications") ? <TabsTrigger value="finance-notifications">Finance Notifications</TabsTrigger> : null}
        {visibleValues.has("notifications") ? <TabsTrigger value="notifications">Notification tools</TabsTrigger> : null}
        {isAdmin && visibleValues.has("message-channels") ? <TabsTrigger value="message-channels">Message channels</TabsTrigger> : null}
        {isAdmin && visibleValues.has("pricebook") ? <TabsTrigger value="pricebook">Price book</TabsTrigger> : null}
        {isAdmin && visibleValues.has("audit") ? <TabsTrigger value="audit">Audit log</TabsTrigger> : null}
        {visibleValues.has("roles") ? <TabsTrigger value="roles">Roles</TabsTrigger> : null}
      </TabsList>

      <TabsContent value="editor">
        <SettingsEditor initialSettings={appSettings} cleanerOptions={cleaners} readOnly={!isAdmin} />
      </TabsContent>

      {isAdmin ? (
        <TabsContent value="accountability">
          <AccountabilitySettingsEditor initial={appSettings.accountability} readOnly={!isAdmin} />
        </TabsContent>
      ) : null}

      <TabsContent value="overview">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Company</p>
                <p className="font-medium">{appSettings.companyName}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Project name</p>
                <p className="font-medium">{appSettings.projectName}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Public App URL</p>
                <p className="font-medium">{configuredAppUrl || "Not configured"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Timezone</p>
                <p className="font-medium">{appSettings.timezone}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Accounts email</p>
                <p className="font-medium">{appSettings.accountsEmail}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">GST on new pricing</p>
                <p className="font-medium">{appSettings.pricing.gstEnabled ? "Enabled" : "Disabled"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {isAdmin ? (
        <TabsContent value="integrations">
          <IntegrationsSettings />
        </TabsContent>
      ) : null}

      {isAdmin ? (
        <TabsContent value="ical-sync">
          <IcalSyncOps />
        </TabsContent>
      ) : null}

      {isAdmin ? (
        <TabsContent value="payment-gateways">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold">Payment Gateways</h3>
              <p className="text-sm text-muted-foreground">Configure client payment providers (Stripe, Square, PayPal).</p>
            </div>
            <PaymentGatewaysTab />
          </div>
        </TabsContent>
      ) : null}

      {isAdmin ? (
        <TabsContent value="xero">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold">Xero Integration</h3>
              <p className="text-sm text-muted-foreground">Connect Xero to sync invoices and contacts.</p>
            </div>
            <XeroTab />
          </div>
        </TabsContent>
      ) : null}

      <TabsContent value="roles" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Portal Access Matrix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(Object.keys(ROLE_SUMMARY) as Role[]).map((role) => (
              <div key={role} className="rounded-lg border p-3">
                <p className="font-medium">{role}</p>
                <p className="text-xs text-muted-foreground">{ROLE_SUMMARY[role]}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Permission Slugs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {permissionRows.map((row) => (
              <div key={row.permission} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <code>{row.permission}</code>
                <span className="text-muted-foreground">{row.roles.join(", ")}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      {isAdmin ? (
        <TabsContent value="pricebook">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Price Book</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {pricebookRows === null ? (
                <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading price book...</div>
              ) : (
                <PricebookEditor
                  initialRows={pricebookRows.map((row) => ({
                    id: row.id,
                    jobType: row.jobType,
                    bedrooms: row.bedrooms,
                    bathrooms: row.bathrooms,
                    baseRate: row.baseRate,
                    addOns: row.addOns as Record<string, number>,
                    isActive: row.isActive,
                  }))}
                  canEdit={isAdmin}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      ) : null}

      {isAdmin ? (
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Settings Audit Log</CardTitle>
            </CardHeader>
            <CardContent>
              {auditEntries === null ? (
                <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading settings history...</div>
              ) : (
                <SettingsAuditLog
                  entries={auditEntries.map((entry) => ({
                    id: entry.id,
                    action: entry.action,
                    createdAt: new Date(entry.createdAt).toISOString(),
                    ipAddress: entry.ipAddress,
                    user: {
                      name: entry.user?.name ?? null,
                      email: entry.user?.email ?? "",
                    },
                    before: entry.before,
                    after: entry.after,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      ) : null}

      <TabsContent value="notifications">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Test Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={emailConfigured ? "success" : "destructive"}>
                  Email provider: {emailConfigured ? "Configured" : "Missing config"}
                </Badge>
                <Badge
                  variant={
                    appSettings.smsProvider === "none"
                      ? "secondary"
                      : activeSmsProviderConfigured
                        ? "success"
                        : "destructive"
                  }
                >
                  SMS active:{" "}
                  {appSettings.smsProvider === "none"
                    ? "Disabled"
                    : `${appSettings.smsProvider === "twilio" ? "Twilio" : "Cellcast"}${
                        activeSmsProviderConfigured ? "" : " (missing config)"
                      }`}
                </Badge>
                <Badge variant={twilioConfigured ? "success" : "secondary"}>
                  Twilio: {twilioConfigured ? "Configured" : "Not configured"}
                </Badge>
                <Badge variant={cellcastConfigured ? "success" : "secondary"}>
                  Cellcast: {cellcastConfigured ? "Configured" : "Not configured"}
                </Badge>
                {isAdmin ? (
                  <Link href="/admin/notifications" className="text-primary underline">
                    View delivery log
                  </Link>
                ) : null}
              </div>
              <NotificationTestForm defaultTo={sessionEmail} />
            </CardContent>
          </Card>

          <ScheduledNotificationControls settings={appSettings.scheduledNotifications} />
        </div>
      </TabsContent>

      {isAdmin ? (
        <TabsContent value="message-channels">
          <NotificationAudienceSettings
            initial={appSettings.notificationAudienceControls}
            readOnly={!isAdmin}
          />
        </TabsContent>
      ) : null}

      {isAdmin ? (
        <TabsContent value="finance-notifications">
          <FinanceNotificationsSettings />
        </TabsContent>
      ) : null}
    </Tabs>
    </div>
  );
}
