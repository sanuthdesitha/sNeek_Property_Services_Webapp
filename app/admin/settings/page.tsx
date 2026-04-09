import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getAppSettings } from "@/lib/settings";
import { SettingsWorkspace } from "@/components/admin/settings-workspace";

export default async function SettingsPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const isAdmin = session.user.role === Role.ADMIN;
  const appSettings = await getAppSettings();
  const cleaners = await db.user.findMany({
    where: { role: Role.CLEANER, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });

  const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  const twilioConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER
  );
  const cellcastConfigured = Boolean(process.env.CELLCAST_APPKEY);
  const activeSmsProviderConfigured =
    appSettings.smsProvider === "none"
      ? true
      : appSettings.smsProvider === "twilio"
        ? twilioConfigured
        : cellcastConfigured;
  const configuredAppUrl =
    process.env.APP_BASE_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "";

  const permissionRows = (Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>).map((permission) => ({
    permission,
    roles: Array.from(PERMISSIONS[permission]),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm text-muted-foreground">Grouped operational settings with lighter initial loading.</p>
      </div>

      <SettingsWorkspace
        appSettings={appSettings}
        cleaners={cleaners}
        isAdmin={isAdmin}
        sessionEmail={session.user.email ?? ""}
        emailConfigured={emailConfigured}
        twilioConfigured={twilioConfigured}
        cellcastConfigured={cellcastConfigured}
        activeSmsProviderConfigured={activeSmsProviderConfigured}
        configuredAppUrl={configuredAppUrl}
        permissionRows={permissionRows}
      />
    </div>
  );
}
