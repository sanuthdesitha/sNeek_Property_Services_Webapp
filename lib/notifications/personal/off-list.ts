import "server-only";
/**
 * Everyone who has something switched off: logins (own switches, all email,
 * email kinds, topics) and client accounts. For the administrator's list in
 * the notifications area; each row links to that person's switches.
 */
import { db } from "@/lib/db";
import { NOTIFICATION_CATEGORIES } from "@/lib/settings";
import { sanitizeSwitchChanges } from "./model";
import { clientStateFromRow, userStateFromRow } from "./resolve";
import { clientOffCount, userOffCount } from "./view";
import type { OffListEntry, SwitchStamp } from "./view-types";

function latestStamp(raw: unknown): SwitchStamp | null {
  const stamps = Object.values(sanitizeSwitchChanges(raw)).sort((a, b) => b.at.localeCompare(a.at));
  const first = stamps[0];
  return first ? { byName: first.byName, byRole: first.byRole, at: first.at } : null;
}

/** Topic (category) switches turned off for the in-app or email route (SMS is off by default). */
function topicsOff(categories: unknown): number {
  if (!categories || typeof categories !== "object" || Array.isArray(categories)) return 0;
  let count = 0;
  for (const category of NOTIFICATION_CATEGORIES) {
    const row = (categories as Record<string, unknown>)[category];
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    if (value.web === false) count += 1;
    if (value.email === false) count += 1;
  }
  return count;
}

export async function listSwitchedOff(limit = 500): Promise<OffListEntry[]> {
  const [users, clients] = await Promise.all([
    db.user.findMany({
      where: {
        OR: [
          { allEmailOff: true },
          { emailPreferences: { some: { enabled: false } } },
          { notificationPreference: { isNot: null } },
        ],
      },
      select: {
        id: true, name: true, role: true, clientId: true, allEmailOff: true,
        emailPreferences: { where: { enabled: false }, select: { key: true } },
        notificationPreference: { select: { switches: true, switchChanges: true, categories: true } },
      },
      take: limit,
    }),
    db.clientNotificationPreference.findMany({
      select: { clientId: true, notificationsEnabled: true, notifyOnEnRoute: true, notifyOnJobStart: true, notifyOnJobComplete: true, preferredChannel: true, switches: true, switchChanges: true, client: { select: { id: true, name: true } } },
      take: limit,
    }),
  ]);
  const entries: OffListEntry[] = [];
  for (const user of users) {
    const state = userStateFromRow(user as never);
    const topics = topicsOff(user.notificationPreference?.categories);
    const offCount = userOffCount(state) + topics;
    if (offCount === 0) continue;
    const parts: string[] = [];
    if (state.switches.all === false) parts.push("All notifications off");
    if (state.allEmailOff) parts.push("All email off");
    const rest = offCount - parts.length;
    if (rest > 0) parts.push(`${rest} other switch${rest === 1 ? "" : "es"} off`);
    entries.push({
      kind: "USER", id: user.id, name: user.name, role: String(user.role), offCount, summary: parts.join(", "),
      lastChange: latestStamp(user.notificationPreference?.switchChanges),
      href: `/v2/admin/accounts/users/${encodeURIComponent(user.id)}?tab=notifications`,
    });
  }
  for (const row of clients) {
    const state = clientStateFromRow({ id: row.client.id, name: row.client.name, notificationPref: row });
    const offCount = clientOffCount(state);
    if (offCount === 0) continue;
    const parts: string[] = [];
    if (!state.notificationsEnabled) parts.push("All notifications off");
    const rest = offCount - parts.length;
    if (rest > 0) parts.push(`${rest} other switch${rest === 1 ? "" : "es"} off`);
    entries.push({
      kind: "CLIENT", id: row.client.id, name: row.client.name, role: "CLIENT", offCount, summary: parts.join(", "),
      lastChange: latestStamp(row.switchChanges),
      href: `/v2/admin/clients/${encodeURIComponent(row.client.id)}?tab=notifications`,
    });
  }
  return entries.sort((a, b) => (b.lastChange?.at ?? "").localeCompare(a.lastChange?.at ?? "") || (a.name ?? "").localeCompare(b.name ?? ""));
}
