import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings, type AppSettings } from "@/lib/settings";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/catalog";
import { EAlert, EPageHeader, ETabs } from "@/components/v2/ui/primitives";
import { CommsCenter } from "@/components/v2/admin/comms/comms-center";
import type { PreferencesSettings } from "@/components/v2/admin/notifications/preferences-tab";
import { HealthTabCount, NotificationHeaderStatus } from "@/components/v2/admin/notifications/header-status";
import { NOTIFICATIONS_TABS, notificationsTabHref, resolveNotificationsTab } from "@/components/v2/admin/notifications/tabs";

export const metadata = { title: "Notifications · Estate admin" };
export const dynamic = "force-dynamic";

const DEFAULT_TIME_ZONE = "Australia/Sydney";

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length <= 100 ? raw : null;
}

/**
 * The one notifications area. Same roles as before (ADMIN and OPS_MANAGER;
 * ops-pack gating "communications" by the shared middleware). Switches are
 * editable by administrators only; wording by administrators and operations
 * managers with the notifications pack at Manage (decided by the server).
 * Settings are read once; a failed read keeps the page working with the
 * organisation timezone default and says so on Preferences.
 */
export default async function V2AdminNotificationsPage({ searchParams }: { searchParams: { tab?: string | string[]; type?: string | string[] } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const isAdmin = session.user.role === Role.ADMIN;
  const tab = resolveNotificationsTab(searchParams?.tab);
  const app: AppSettings | null = await getAppSettings().catch(() => null);
  const timeZone = app?.timezone || DEFAULT_TIME_ZONE;
  const settings: PreferencesSettings | null = tab === "preferences" && isAdmin && app
    ? {
      automation: {
        scheduledNotifications: app.scheduledNotifications,
        notificationDefaults: { categories: app.notificationDefaults.categories as Record<string, { web?: boolean; email?: boolean; sms?: boolean }> },
      },
      audience: app.notificationAudienceControls,
    }
    : null;
  const tabItems = NOTIFICATIONS_TABS.map((item) => ({
    key: item.key,
    label: item.key === "types" ? `${item.label} ${NOTIFICATION_CATALOG.length}` : item.label,
    badge: item.key === "health" ? <HealthTabCount /> : undefined,
  }));
  return (
    <div className="min-w-0 space-y-6">
      <EPageHeader
        eyebrow="Configuration"
        title="Notifications"
        description="Every notification the system sends: wording, who gets it, by which transport, and what happened to it."
        actions={<NotificationHeaderStatus showTestButton={tab === "types"} />}
      />
      <ETabs ariaLabel="Notifications sections" items={tabItems} active={tab} hrefFor={notificationsTabHref} />
      {tab === "preferences" && isAdmin && !app ? <EAlert tone="danger" title="Settings could not be read">Scheduled notifications, message channels and finance templates are hidden until the settings load. Reload the page to try again.</EAlert> : null}
      <CommsCenter
        tab={tab}
        isAdmin={isAdmin}
        readOnly={Boolean(session.impersonation)}
        settings={settings}
        timeZone={timeZone}
        companyName={app?.companyName || "sNeek Property Services"}
        initialType={firstParam(searchParams?.type)}
      />
    </div>
  );
}
