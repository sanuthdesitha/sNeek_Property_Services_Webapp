import "server-only";
import { db } from "@/lib/db";
import { readNotificationHealth } from "@/lib/notifications/health";
import type { SettingsDestinationState, SettingsRecentChange } from "./settings-home-types";

/**
 * Real state for the Settings home, read on the server. A destination gets a
 * badge only when a stored fact says something needs attention; a read that
 * fails leaves the destination without a badge (never "all good").
 *
 * - xero: the stored Xero sign-in (lapsed / no refresh token).
 * - notification-tools: SMS sends that failed in the last 24 hours.
 * - recent changes: the settings audit trail (administrators only, as the
 *   audit page is).
 */
export async function loadSettingsHomeState(options: { isAdmin: boolean }): Promise<{
  states: Record<string, SettingsDestinationState>;
  recent: SettingsRecentChange[] | null;
}> {
  const states: Record<string, SettingsDestinationState> = {};
  const [health, recent] = await Promise.allSettled([
    readNotificationHealth(),
    options.isAdmin
      ? db.auditLog.findMany({
          where: { entity: "AppSettings", entityId: "app" },
          select: { id: true, createdAt: true, action: true, user: { select: { name: true, email: true } } },
          orderBy: { createdAt: "desc" },
          take: 3,
        })
      : Promise.resolve(null),
  ]);

  if (health.status === "fulfilled") {
    const xero = health.value.xero;
    if (options.isAdmin && xero?.signIn === "lapsed") states.xero = { tone: "bad", text: "Reconnect", detail: xero.message ?? "Xero sign-in lapsed." };
    else if (options.isAdmin && xero?.signIn === "no-refresh-token") states.xero = { tone: "warn", text: "Reconnect once", detail: xero.message ?? "Reconnect Xero once to keep it signed in." };
    const sms = health.value.transports.find((transport) => transport.transport === "SMS");
    if (sms && sms.failures24h > 0) {
      states["notification-tools"] = { tone: "bad", text: "SMS failing", detail: `${sms.failures24h} SMS failure${sms.failures24h === 1 ? "" : "s"} in 24 h` };
    }
  }

  const recentRows =
    recent.status === "fulfilled" && recent.value
      ? recent.value.map((row) => ({ id: row.id, at: row.createdAt.toISOString(), action: row.action, by: row.user?.name || row.user?.email || "Someone" }))
      : options.isAdmin
        ? null
        : [];
  return { states, recent: recentRows };
}
