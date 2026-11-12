export const NOTIFICATIONS_TABS = [
  { key: "types", label: "Types and wording" },
  { key: "log", label: "Delivery log" },
  { key: "health", label: "Health" },
  { key: "preferences", label: "Preferences" },
] as const;

export type NotificationsTab = (typeof NOTIFICATIONS_TABS)[number]["key"];

/** Unknown or missing `?tab=` opens Types; old links without a tab keep working. */
export function resolveNotificationsTab(raw: string | string[] | undefined): NotificationsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return NOTIFICATIONS_TABS.find((tab) => tab.key === value)?.key ?? "types";
}

export function notificationsTabHref(key: string): string {
  return key === "types" ? "/v2/admin/notifications" : `/v2/admin/notifications?tab=${key}`;
}
