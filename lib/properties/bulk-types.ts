/** Bulk action vocabulary for the Properties list. Pure; safe for client bundles. */
import { z } from "zod";

export const PROPERTY_BULK_ACTIONS = ["set-laundry-team", "assign-checklist", "sync-calendars"] as const;
export type PropertyBulkAction = (typeof PROPERTY_BULK_ACTIONS)[number];

/** Laundry and checklist changes are quick writes; a calendar sync fetches each feed in turn. */
export const PROPERTY_BULK_MAX = 100;
export const PROPERTY_SYNC_BULK_MAX = 20;

export type PropertyBulkOutcome = "done" | "unchanged" | "refused" | "failed";
export type PropertyBulkResult = { id: string; outcome: PropertyBulkOutcome; message: string };

const ids = z.array(z.string().trim().min(1).max(128)).min(1).max(PROPERTY_BULK_MAX);

export const propertyBulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-laundry-team"), ids, userIds: z.array(z.string().trim().min(1).max(128)).max(20) }).strict(),
  z.object({ action: z.literal("assign-checklist"), ids, jobType: z.string().trim().min(1).max(64), templateId: z.string().trim().min(1).max(128) }).strict(),
  z.object({ action: z.literal("sync-calendars"), ids: ids.max(PROPERTY_SYNC_BULK_MAX) }).strict(),
]);
export type PropertyBulkRequest = z.infer<typeof propertyBulkSchema>;

export const PROPERTY_BULK_OUTCOME_LABEL: Record<PropertyBulkOutcome, string> = {
  done: "Done",
  unchanged: "No change",
  refused: "Refused",
  failed: "Failed",
};
