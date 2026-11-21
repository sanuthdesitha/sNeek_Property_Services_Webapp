import "server-only";
/**
 * The older client preference shape ({ notificationsEnabled, notifyOn…,
 * preferredChannel }) translated into switch changes, so the older routes
 * write through the one switch path (stamped, audited, revision bumped).
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { clientEventSwitchId, typeSwitchId } from "./model";
import { CLIENT_JOB_UPDATES_TYPE } from "./decide";
import type { SwitchChangeInput } from "./write";

export const legacyClientPreferenceSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
  notifyOnEnRoute: z.boolean().optional(),
  notifyOnJobStart: z.boolean().optional(),
  notifyOnJobComplete: z.boolean().optional(),
  preferredChannel: z.enum(["EMAIL", "SMS", "BOTH"]).optional(),
});

export type LegacyClientPreference = z.infer<typeof legacyClientPreferenceSchema>;

/** Switching on before switching off keeps the preferred channel a single value (EMAIL → SMS, not BOTH). */
export function legacyClientChanges(input: LegacyClientPreference): SwitchChangeInput[] {
  const changes: SwitchChangeInput[] = [];
  if (input.notificationsEnabled !== undefined) changes.push({ id: "all", on: input.notificationsEnabled });
  if (input.notifyOnEnRoute !== undefined) changes.push({ id: clientEventSwitchId("enRoute"), on: input.notifyOnEnRoute });
  if (input.notifyOnJobStart !== undefined) changes.push({ id: clientEventSwitchId("started"), on: input.notifyOnJobStart });
  if (input.notifyOnJobComplete !== undefined) changes.push({ id: clientEventSwitchId("finished"), on: input.notifyOnJobComplete });
  if (input.preferredChannel) {
    const email = { id: typeSwitchId(CLIENT_JOB_UPDATES_TYPE, "EMAIL"), on: input.preferredChannel !== "SMS" };
    const sms = { id: typeSwitchId(CLIENT_JOB_UPDATES_TYPE, "SMS"), on: input.preferredChannel !== "EMAIL" };
    changes.push(...[email, sms].sort((a, b) => Number(b.on) - Number(a.on)));
  }
  return changes;
}

/** The older response shape (defaults when the client has no row). */
export async function legacyClientPreferenceRow(clientId: string) {
  const pref = await db.clientNotificationPreference.findUnique({ where: { clientId } });
  return {
    clientId,
    notificationsEnabled: pref?.notificationsEnabled ?? true,
    notifyOnEnRoute: pref?.notifyOnEnRoute ?? true,
    notifyOnJobStart: pref?.notifyOnJobStart ?? true,
    notifyOnJobComplete: pref?.notifyOnJobComplete ?? true,
    preferredChannel: pref?.preferredChannel ?? "EMAIL",
    ...(pref ? { createdAt: pref.createdAt, updatedAt: pref.updatedAt } : {}),
  };
}
