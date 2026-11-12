"use client";

import { CommsControlCenter } from "@/components/v2/admin/comms/control-center";
import type { EstateToast } from "@/components/v2/admin/comms/toast";
import { NotificationsAutomationSection, type NotificationsAutomationSettings } from "@/components/v2/admin/settings/notifications-automation-section";
import { NotificationAudienceSection } from "@/components/v2/admin/settings/notification-audience-section";
import { FinanceNotificationsSection } from "@/components/v2/admin/settings/finance-notifications-section";
import type { NotificationAudienceControls } from "@/lib/notifications/audience-controls";
import { LazyDisclosure } from "./lazy-disclosure";

export type PreferencesSettings = {
  automation: NotificationsAutomationSettings;
  audience: NotificationAudienceControls;
};

/**
 * Organisation-level notification defaults and audience controls, gathered
 * here. The same components as the settings tabs, saving through the same
 * endpoints; the settings tabs keep working at their old URLs. A person's own
 * preferences stay on their Accounts panel (linked, not duplicated).
 */
export function PreferencesTab({ isAdmin, settings, onToast }: { isAdmin: boolean; settings: PreferencesSettings | null; onToast: (toast: EstateToast) => void }) {
  return (
    <section aria-labelledby="preferences-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="preferences-heading" className="text-lg font-semibold">Preferences</h2>
        <p className="text-sm text-[hsl(var(--e-muted-foreground))]">
          Organisation defaults, automatic email switches and audience channel controls. Each person&apos;s own choices are on their panel in{" "}
          <a className="underline" href="/v2/admin/accounts">Accounts</a>.
        </p>
      </div>

      <CommsControlCenter onToast={onToast} />

      {isAdmin && settings ? (
        <>
          <LazyDisclosure id="scheduled-notifications" summary="Scheduled notifications and category defaults">
            <NotificationsAutomationSection initial={settings.automation} readOnly={false} />
          </LazyDisclosure>
          <LazyDisclosure id="message-channels" summary="Message channels (email, SMS and push for each audience)">
            <NotificationAudienceSection initial={settings.audience} readOnly={false} />
          </LazyDisclosure>
          <LazyDisclosure id="finance-notifications" summary="Finance notification templates and per-event switches">
            <FinanceNotificationsSection />
          </LazyDisclosure>
        </>
      ) : (
        <p className="text-sm text-[hsl(var(--e-muted-foreground))]">Scheduled notifications, message channels and finance templates are changed by administrators.</p>
      )}
    </section>
  );
}
