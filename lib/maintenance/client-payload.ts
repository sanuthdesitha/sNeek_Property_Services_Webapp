/**
 * What a CLIENT login must never receive from the shared maintenance routes
 * (GET /api/maintenance and GET /api/maintenance/:id): our internal estimate
 * (cost to us), the instructions written for our own workers, and the office's
 * side of client-handled maintenance (who handed it over and reminded, the
 * delivery outcomes, the take-back reason). The client's own hand-over view
 * has its own route (lib/maintenance/client-handling.ts) and never had these.
 *
 * PURE.
 */
export const CLIENT_HIDDEN_ITEM_KEYS = [
  "estimatedCost",
  "assignmentInstructions",
  "clientHandedOverById",
  "clientHandoverNotice",
  "clientRespondedById",
  "clientTradespersonById",
  "clientOutcomeById",
  "clientReminderCount",
  "clientLastReminderAt",
  "clientLastReminderById",
  "clientLastReminderKey",
  "clientLastReminderOutcome",
  "clientTakenBackById",
  "clientTakenBackReason",
] as const;

export function stripForClient<T extends Record<string, unknown>>(item: T): Omit<T, (typeof CLIENT_HIDDEN_ITEM_KEYS)[number]> {
  const copy: Record<string, unknown> = { ...item };
  for (const key of CLIENT_HIDDEN_ITEM_KEYS) delete copy[key];
  return copy as Omit<T, (typeof CLIENT_HIDDEN_ITEM_KEYS)[number]>;
}
