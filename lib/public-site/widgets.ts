import { getAppSettings, DEFAULT_PUBLIC_WIDGETS, type PublicWidgetFlags } from "@/lib/settings";

export type { PublicWidgetFlags };
export { DEFAULT_PUBLIC_WIDGETS };

/**
 * Read public widget visibility flags from AppSettings.
 *
 * Admin can toggle individual widgets on/off via the admin settings UI.
 * Defaults to all-enabled if the setting is missing.
 *
 * Used by the public marketing site to conditionally render widgets like
 * the instant quote estimator, availability checker, live chat, etc.
 */
export async function getPublicWidgetFlags(): Promise<PublicWidgetFlags> {
  const settings = await getAppSettings();
  return settings.publicWidgets ?? DEFAULT_PUBLIC_WIDGETS;
}
