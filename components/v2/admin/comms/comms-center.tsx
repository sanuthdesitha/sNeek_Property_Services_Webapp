"use client";

import { EToastViewport, useEstateToast } from "@/components/v2/admin/comms/toast";
import { TypesTab } from "@/components/v2/admin/notifications/types-tab";
import { DeliveryLogTab } from "@/components/v2/admin/notifications/delivery-log-tab";
import { HealthTab } from "@/components/v2/admin/notifications/health-tab";
import { PreferencesTab, type PreferencesSettings } from "@/components/v2/admin/notifications/preferences-tab";
import type { NotificationsTab } from "@/components/v2/admin/notifications/tabs";

/**
 * The one notifications area (/v2/admin/notifications). The page renders the
 * single heading and the tab links; this renders the active tab. Every control
 * of the former Comms center is kept: the control center and profile
 * overrides under Preferences, the classic log, review queue and "Clear log"
 * under Delivery log, manual dispatch and the test push under Health.
 */
type CommsCenterProps = {
  tab: NotificationsTab;
  isAdmin: boolean;
  readOnly: boolean;
  settings: PreferencesSettings | null;
  /** The organisation timezone: every history time on these tabs is shown in it. */
  timeZone?: string;
  companyName?: string;
  /** `?type=` deep link to a notification type on Types and wording. */
  initialType?: string | null;
  /** `?email=` deep link to one email's editor on Types and wording. */
  initialEmail?: string | null;
};

export function CommsCenter({ tab, isAdmin, readOnly, settings, timeZone = "Australia/Sydney", companyName = "sNeek Property Services", initialType = null, initialEmail = null }: CommsCenterProps) {
  const { toast, push } = useEstateToast();
  return (
    <div className="space-y-6">
      {tab === "types" ? <TypesTab isAdmin={isAdmin} readOnly={readOnly} timeZone={timeZone} companyName={companyName} initialType={initialType} initialEmail={initialEmail} /> : null}
      {tab === "log" ? <DeliveryLogTab readOnly={readOnly} onToast={push} timeZone={timeZone} /> : null}
      {tab === "health" ? <HealthTab isAdmin={isAdmin} onToast={push} timeZone={timeZone} /> : null}
      {tab === "preferences" ? <PreferencesTab isAdmin={isAdmin} settings={settings} onToast={push} timeZone={timeZone} /> : null}
      <EToastViewport toast={toast} />
    </div>
  );
}
