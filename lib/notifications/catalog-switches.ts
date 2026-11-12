import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAppSettings, saveAppSettings, type AppSettings } from "@/lib/settings";
import { EMAIL_AUTO_KIND_KEYS, type EmailAutoKind } from "./email-kinds";
import { NOTIFICATION_CATALOG, catalogTemplateHref } from "./catalog";
import type { TransportSwitch } from "./catalog-types";
import type { CatalogTypeView, ResolvedSwitch } from "./catalog-view-types";
import { transportPath } from "./transport-paths";
import type { NotificationTypeControls } from "./type-controls";

/**
 * Resolves each catalog type's switches to the EXISTING setting that governs
 * them (email automation kinds, scheduled notifications, the SMS provider) and
 * changes one of them in place. No new copy of those settings is kept.
 */
const SCHEDULED_LABEL: Record<string, string> = {
  reminder24hEnabled: "24-hour reminders",
  reminder2hEnabled: "2-hour reminders",
  tomorrowPrepEnabled: "Tomorrow prep",
  stockAlertsEnabled: "Daily stock alerts",
  adminAttentionSummaryEnabled: "Attention summary",
};

function resolveSwitch(item: TransportSwitch, settings: AppSettings): ResolvedSwitch | null {
  switch (item.kind) {
    case "EMAIL_KIND": {
      const master = settings.emailAutomation?.masterEnabled !== false;
      const on = settings.emailAutomation?.types?.[item.emailKind] !== false;
      return { id: `email:${item.emailKind}`, label: `Automatic email: ${item.emailKind.replace(/_/g, " ")}`, enabled: master && on, editable: true, href: null, note: master ? null : "All automatic email is switched off (master switch)." };
    }
    case "SCHEDULED":
      return { id: `scheduled:${item.setting}`, label: SCHEDULED_LABEL[item.setting] ?? item.setting, enabled: settings.scheduledNotifications?.[item.setting] === true, editable: true, href: null, note: null };
    case "SMS_PROVIDER":
      return { id: "sms-provider", label: "SMS provider", enabled: settings.smsProvider !== "none", editable: false, href: "/v2/admin/settings?tab=integrations", note: "Change the SMS provider in Integrations." };
    case "FINANCE_EVENT":
      return { id: "finance-events", label: "Per-event switches", enabled: null, editable: false, href: "/v2/admin/notifications?tab=preferences#finance-notifications", note: "Per event and recipient, in Preferences." };
    case "CLIENT_JOB_PREFERENCES":
      return { id: "client-prefs", label: "Each client's update choices", enabled: null, editable: false, href: "/v2/admin/notifications?tab=preferences", note: "Per client, in Preferences (client overrides)." };
    case "TYPE_CONTROL":
      return null;
    case "NONE":
      return null;
  }
}

export async function catalogView(controls: NotificationTypeControls): Promise<CatalogTypeView[]> {
  const settings = await getAppSettings();
  return NOTIFICATION_CATALOG.map((entry) => ({
    ...entry,
    resolvedSwitches: entry.switches.flatMap((item) => {
      const resolved = resolveSwitch(item, settings);
      return resolved ? [resolved] : [];
    }),
    respectsPreferencesNow: entry.preferences === "ADMIN_SWITCH" ? controls.respectsPreferences[entry.key] === true : null,
    disabledTransports: controls.disabledTransports[entry.key] ?? [],
    externalPaths: entry.path === "PIPELINE_WITH_FALLBACK"
      ? Object.fromEntries(entry.transports.flatMap((transport) => (transport === "EMAIL" || transport === "SMS" || transport === "WEB_PUSH" ? [[transport, transportPath(transport)]] : [])))
      : {},
    templateHref: catalogTemplateHref(entry),
  }));
}

export const existingSwitchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EMAIL_KIND"), emailKind: z.enum(EMAIL_AUTO_KIND_KEYS as [EmailAutoKind, ...EmailAutoKind[]]), enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal("SCHEDULED"), setting: z.enum(["reminder24hEnabled", "reminder2hEnabled", "tomorrowPrepEnabled", "stockAlertsEnabled", "adminAttentionSummaryEnabled"]), enabled: z.boolean() }).strict(),
]);
export type ExistingSwitchChange = z.infer<typeof existingSwitchSchema>;

/** ADMIN-only caller. Changes exactly one key of the existing setting and audits it like the settings page. */
export async function changeExistingSwitch(actorId: string, change: ExistingSwitchChange): Promise<void> {
  const before = await getAppSettings();
  const patch: Partial<AppSettings> = change.kind === "EMAIL_KIND"
    ? { emailAutomation: { ...before.emailAutomation, types: { ...before.emailAutomation.types, [change.emailKind]: change.enabled } } }
    : { scheduledNotifications: { ...before.scheduledNotifications, [change.setting]: change.enabled } };
  const after = await saveAppSettings(patch);
  await db.auditLog.create({ data: {
    userId: actorId, action: "SETTINGS_UPDATE", entity: "AppSettings", entityId: "app",
    before: { source: "notifications-area", change: { ...change, enabled: !change.enabled } },
    after: { source: "notifications-area", change, emailAutomation: after.emailAutomation.types, scheduledNotifications: { ...after.scheduledNotifications } },
  } });
}
