import { z } from "zod";

export const inboxStateSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  followUp: z.enum(["NONE", "NEEDS_ACTION", "RESOLVED"]), archived: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
  // Optional for persisted version-1 records written before snooze existed.
  snoozedUntil: z.string().datetime().nullable().optional(),
  acknowledgedAt: z.string().datetime().nullable().optional(),
}).strict();
export type InboxState = z.infer<typeof inboxStateSchema>;
export const emptyInboxState = (): InboxState => ({ version: 1, revision: 0, followUp: "NONE", archived: false, updatedAt: null });
export const inboxMutationSchema = z.object({
  id: z.string().min(1).max(200), revision: z.number().int().nonnegative(),
  action: z.enum(["NEEDS_ACTION", "RESOLVE", "CLEAR_FOLLOW_UP", "ARCHIVE", "RESTORE", "SNOOZE", "UNSNOOZE", "ACKNOWLEDGE"]),
  snoozedUntil: z.string().datetime().optional(),
}).strict().refine(value => value.action === "SNOOZE" ? Boolean(value.snoozedUntil) : value.snoozedUntil === undefined);
export type InboxMutation = z.infer<typeof inboxMutationSchema>;
export function isInboxSnoozed(state: InboxState | undefined, now = Date.now()) {
  return Boolean(state?.snoozedUntil && Date.parse(state.snoozedUntil) > now);
}
export function nextInboxState(current: InboxState, action: InboxMutation["action"], snoozedUntil?: string): InboxState {
  return inboxStateSchema.parse({ ...current, revision: current.revision + 1, updatedAt: new Date().toISOString(),
    ...(action === "ACKNOWLEDGE" ? { acknowledgedAt: new Date().toISOString() }
      : action === "SNOOZE" ? { snoozedUntil } : action === "UNSNOOZE" ? { snoozedUntil: null }
      : action === "ARCHIVE" ? { archived: true, snoozedUntil: null } : action === "RESTORE" ? { archived: false }
      : { followUp: action === "NEEDS_ACTION" ? "NEEDS_ACTION" : action === "RESOLVE" ? "RESOLVED" : "NONE" }) });
}
