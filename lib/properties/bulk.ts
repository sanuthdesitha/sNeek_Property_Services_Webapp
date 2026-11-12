import "server-only";
/**
 * Properties bulk actions. Each runs every selected property through the same
 * service its single-property screen uses and answers per property; a refused
 * or failed property is never reported as done.
 *
 *  - set-laundry-team: lib/properties/laundry-team.ts (the property page's
 *    laundry allocation, merged into accessInfo).
 *  - assign-checklist: lib/properties/form-overrides.ts (the property page's
 *    "Form templates" override for one job type).
 *  - sync-calendars: lib/ical/sync.ts syncPropertyIcal (the "Sync now" button),
 *    one property at a time.
 */
import { JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { syncPropertyIcal } from "@/lib/ical/sync";
import { resolveLaundryAccounts, setPropertyLaundryTeam } from "./laundry-team";
import { FormOverrideError, readPropertyFormOverrides, validateOverrideTemplates, writePropertyFormOverrides, type OverrideChange } from "./form-overrides";
import type { PropertyBulkRequest, PropertyBulkResult } from "./bulk-types";

/** A request that cannot run at all (bad partner, inactive template). The route answers 400. */
export class PropertyBulkError extends Error {
  readonly status = 400;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Unknown error";
}

async function setLaundryTeam(ids: string[], userIds: string[], actorId: string): Promise<PropertyBulkResult[]> {
  const unique = Array.from(new Set(userIds));
  const { invalid } = await resolveLaundryAccounts(unique);
  if (invalid.length > 0) throw new PropertyBulkError("Choose active laundry accounts only.");
  const results: PropertyBulkResult[] = [];
  for (const id of ids) {
    try {
      results.push({ id, ...(await setPropertyLaundryTeam(id, unique, actorId)) });
    } catch (error) {
      logger.error({ err: error, propertyId: id }, "Bulk laundry partner change failed");
      results.push({ id, outcome: "failed", message: errorMessage(error) });
    }
  }
  return results;
}

async function assignChecklist(ids: string[], jobTypeRaw: string, templateId: string, actorId: string, ipAddress: string | null): Promise<PropertyBulkResult[]> {
  if (!(Object.values(JobType) as string[]).includes(jobTypeRaw)) throw new PropertyBulkError("Choose a job type.");
  const jobType = jobTypeRaw as JobType;
  try {
    await validateOverrideTemplates({ [jobType]: templateId });
  } catch (error) {
    if (error instanceof FormOverrideError) throw new PropertyBulkError(error.message);
    throw error;
  }
  const active = new Set(
    (await db.property.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } })).map((row) => row.id),
  );
  const results = new Map<string, PropertyBulkResult>();
  const changes: OverrideChange[] = [];
  for (const id of ids) {
    if (!active.has(id)) {
      results.set(id, { id, outcome: "refused", message: "Property not found or archived." });
      continue;
    }
    const before = await readPropertyFormOverrides(id);
    if (before[jobType] === templateId) {
      results.set(id, { id, outcome: "unchanged", message: "Already uses this checklist." });
      continue;
    }
    changes.push({ propertyId: id, next: { ...before, [jobType]: templateId } });
  }
  if (changes.length > 0) {
    try {
      const saved = await writePropertyFormOverrides(changes, actorId, ipAddress);
      for (const change of changes) {
        const applied = saved.get(change.propertyId)?.[jobType] === templateId;
        results.set(change.propertyId, applied
          ? { id: change.propertyId, outcome: "done", message: "Checklist assigned." }
          : { id: change.propertyId, outcome: "failed", message: "The settings save did not keep this override." });
      }
    } catch (error) {
      logger.error({ err: error }, "Bulk checklist assignment failed");
      for (const change of changes) results.set(change.propertyId, { id: change.propertyId, outcome: "failed", message: errorMessage(error) });
    }
  }
  return ids.map((id) => results.get(id)!);
}

async function syncCalendars(ids: string[], actorId: string): Promise<PropertyBulkResult[]> {
  const integrations = await db.integration.findMany({
    where: { propertyId: { in: ids }, property: { isActive: true } },
    select: { id: true, propertyId: true, isEnabled: true, icalUrl: true, syncStatus: true },
  });
  const byProperty = new Map(integrations.map((row) => [row.propertyId, row]));
  const results: PropertyBulkResult[] = [];
  for (const id of ids) {
    const integration = byProperty.get(id);
    if (!integration || !integration.isEnabled || !integration.icalUrl) {
      results.push({ id, outcome: "refused", message: "Calendar not linked." });
      continue;
    }
    if (integration.syncStatus === "SYNCING") {
      results.push({ id, outcome: "refused", message: "A sync is already running." });
      continue;
    }
    try {
      const { summary } = await syncPropertyIcal(integration.id, { triggeredById: actorId, mode: "MANUAL" });
      results.push({
        id,
        outcome: "done",
        message: `${summary.reservationsCreated} reservations, ${summary.jobsCreated} jobs created, ${summary.jobsUpdated} updated.`,
      });
    } catch (error) {
      results.push({ id, outcome: "failed", message: errorMessage(error) });
    }
  }
  return results;
}

export async function runPropertyBulk(request: PropertyBulkRequest, actorId: string, ipAddress: string | null): Promise<PropertyBulkResult[]> {
  const ids = Array.from(new Set(request.ids));
  switch (request.action) {
    case "set-laundry-team":
      return setLaundryTeam(ids, request.userIds, actorId);
    case "assign-checklist":
      return assignChecklist(ids, request.jobType, request.templateId, actorId, ipAddress);
    case "sync-calendars":
      return syncCalendars(ids, actorId);
  }
}
