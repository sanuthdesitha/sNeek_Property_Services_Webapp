import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/utils";
import { NotificationTestForm } from "@/components/admin/notification-test-form";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getAppSettings } from "@/lib/settings";
import { SettingsEditor } from "@/components/admin/settings-editor";
import { PricebookEditor } from "@/components/admin/pricebook-editor";
import { SettingsAuditLog } from "@/components/admin/settings-audit-log";

const ROLE_SUMMARY: Record<Role, string> = {
  [Role.ADMIN]: "Full platform access including settings and pricing",
  [Role.OPS_MANAGER]: "Jobs, QA, reports, clients, properties, and quotes",
  [Role.CLEANER]: "Assigned jobs, form submission, uploads, and time logs",
  [Role.CLIENT]: "Own properties and reports only",
  [Role.LAUNDRY]: "Laundry week schedule and ready queue",
};

export default async function SettingsPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const isAdmin = session.user.role === Role.ADMIN;
  const appSettings = await getAppSettings();
  const cleaners = await db.user.findMany({
    where: { role: Role.CLEANER, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });

  const pricebook = isAdmin
    ? await db.priceBook.findMany({ where: { isActive: true }, orderBy: [{ jobType: "asc" }, { bedrooms: "asc" }] })
    : [];
  const settingsAuditEntries = isAdmin
    ? await db.auditLog.findMany({
        where: {
          entity: "AppSettings",
          entityId: "app",
        },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      })
    : [];

  const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  const smsConfigured = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
  const configuredAppUrl = process.env.APP_BASE_URL?.trim() || process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || "";

  const permissionRows = (Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>).map((permission) => ({
    permission,
    roles: PERMISSIONS[permission],
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm text-muted-foreground">System configuration and operational defaults</p>
      </div>

      <SettingsEditor initialSettings={appSettings} cleanerOptions={cleaners} readOnly={!isAdmin} />

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          {isAdmin && <TabsTrigger value="pricebook">Price Book</TabsTrigger>}
          {isAdmin && <TabsTrigger value="audit">Audit Log</TabsTrigger>}
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
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
                  {!configuredAppUrl ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Set `APP_BASE_URL` (or `APP_URL`) so emails and shared links always use your domain/IP.
                    </p>
                  ) : null}
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

              <div className="rounded-lg border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Tech stack (fixed)</p>
                <p className="text-sm">
                  Next.js 14+ (App Router) + TypeScript, PostgreSQL, Prisma ORM, NextAuth, Tailwind + shadcn/ui,
                  TanStack Table, FullCalendar, S3-compatible storage, pg-boss, Playwright PDF, Resend, Twilio,
                  Zod, and pino.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reminders">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Job Reminder Defaults</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                <div>
                  <p className="font-medium">24-hour reminder</p>
                  <p className="text-xs text-muted-foreground">
                    Email sent to assigned cleaners {appSettings.reminder24hHours}h before job
                  </p>
                </div>
                <Badge variant="success">Active</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                <div>
                  <p className="font-medium">2-hour reminder</p>
                  <p className="text-xs text-muted-foreground">
                    SMS sent to assigned cleaners {appSettings.reminder2hHours}h before job
                  </p>
                </div>
                <Badge variant="success">Active</Badge>
              </div>
              <p className="pt-2 text-xs text-muted-foreground">
                Reminders are dispatched by the pg-boss worker every 5 minutes. Per-job overrides can be set from job details.
              </p>
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

        {isAdmin && (
          <TabsContent value="pricebook">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Price Book</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <PricebookEditor
                  initialRows={pricebook.map((row) => ({
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
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="audit">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Settings Audit Log</CardTitle>
              </CardHeader>
              <CardContent>
                <SettingsAuditLog
                  entries={settingsAuditEntries.map((entry) => ({
                    id: entry.id,
                    action: entry.action,
                    createdAt: entry.createdAt.toISOString(),
                    ipAddress: entry.ipAddress,
                    user: {
                      name: entry.user.name,
                      email: entry.user.email,
                    },
                    before: entry.before,
                    after: entry.after,
                  }))}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Test Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={emailConfigured ? "success" : "destructive"}>
                  Email provider: {emailConfigured ? "Configured" : "Missing config"}
                </Badge>
                <Badge variant={smsConfigured ? "success" : "secondary"}>
                  SMS provider: {smsConfigured ? "Configured" : "Not configured"}
                </Badge>
                {isAdmin && (
                  <Link href="/admin/notifications" className="text-primary underline">
                    View delivery log
                  </Link>
                )}
              </div>
              <NotificationTestForm defaultTo={session.user.email} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

