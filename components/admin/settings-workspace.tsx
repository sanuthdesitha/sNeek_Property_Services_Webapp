"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Role } from "@prisma/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AppSettings } from "@/lib/settings";

const SettingsEditor = dynamic(
  () => import("@/components/admin/settings-editor").then((mod) => mod.SettingsEditor),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading settings editor...</div> }
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
const ScheduledNotificationControls = dynamic(
  () => import("@/components/admin/scheduled-notification-controls").then((mod) => mod.ScheduledNotificationControls),
  { loading: () => <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading scheduled tools...</div> }
);

const ROLE_SUMMARY: Record<Role, string> = {
  [Role.ADMIN]: "Full platform access including settings and pricing",
  [Role.OPS_MANAGER]: "Jobs, QA, reports, clients, properties, and quotes",
  [Role.CLEANER]: "Assigned jobs, form submission, uploads, and time logs",
  [Role.CLIENT]: "Own properties and reports only",
  [Role.LAUNDRY]: "Laundry week schedule and ready queue",
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
}: SettingsWorkspaceProps) {
  const [tab, setTab] = useState("editor");
  const [pricebookRows, setPricebookRows] = useState<any[] | null>(null);
  const [auditEntries, setAuditEntries] = useState<any[] | null>(null);

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
    <Tabs value={tab} onValueChange={setTab} className="space-y-6">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
        <TabsTrigger value="editor">Core settings</TabsTrigger>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
        {isAdmin ? <TabsTrigger value="pricebook">Price book</TabsTrigger> : null}
        {isAdmin ? <TabsTrigger value="audit">Audit log</TabsTrigger> : null}
        <TabsTrigger value="notifications">Notification tools</TabsTrigger>
      </TabsList>

      <TabsContent value="editor">
        <SettingsEditor initialSettings={appSettings} cleanerOptions={cleaners} readOnly={!isAdmin} />
      </TabsContent>

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
            </div>
          </CardContent>
        </Card>
      </TabsContent>

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
    </Tabs>
  );
}
