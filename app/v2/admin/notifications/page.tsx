import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { EPageHeader, ETabs } from "@/components/v2/ui/primitives";
import { CommsCenter } from "@/components/v2/admin/comms/comms-center";
import type { PreferencesSettings } from "@/components/v2/admin/notifications/preferences-tab";
import { NOTIFICATIONS_TABS, notificationsTabHref, resolveNotificationsTab } from "@/components/v2/admin/notifications/tabs";

export const metadata = { title: "Notifications · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * The one notifications area. Same roles as before (ADMIN and OPS_MANAGER;
 * ops-pack gating "communications" by the shared middleware). Switches are
 * editable by administrators only, matching the settings and preference APIs.
 */
export default async function V2AdminNotificationsPage({ searchParams }: { searchParams: { tab?: string | string[] } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const isAdmin = session.user.role === Role.ADMIN;
  const tab = resolveNotificationsTab(searchParams?.tab);
  let settings: PreferencesSettings | null = null;
  let timeZone = "Australia/Sydney";
  if (tab === "preferences") timeZone = (await getAppSettings().catch(() => null))?.timezone || timeZone;
  if (tab === "preferences" && isAdmin) {
    const app = await getAppSettings();
    settings = {
      automation: {
        scheduledNotifications: app.scheduledNotifications,
        notificationDefaults: { categories: app.notificationDefaults.categories as Record<string, { web?: boolean; email?: boolean; sms?: boolean }> },
      },
      audience: app.notificationAudienceControls,
    };
  }
  return (
    <div className="min-w-0 space-y-6">
      <EPageHeader
        eyebrow="Configuration"
        title="Notifications"
        description="Every notification the system sends: who receives it, by which transport, whether it is on, and what happened to it."
      />
      <ETabs ariaLabel="Notifications sections" items={NOTIFICATIONS_TABS.map((item) => ({ key: item.key, label: item.label }))} active={tab} hrefFor={notificationsTabHref} />
      <CommsCenter tab={tab} isAdmin={isAdmin} readOnly={Boolean(session.impersonation)} settings={settings} timeZone={timeZone} />
    </div>
  );
}
