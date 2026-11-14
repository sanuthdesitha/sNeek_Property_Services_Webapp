import "server-only";
import type { JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { resolveJobFormTemplate } from "@/lib/forms/resolve-job-template";
import { resolvePropertyCleanHours } from "@/lib/properties/clean-hours";
import { resolveAssignmentPayRate } from "@/lib/finance/assignment-rate";
import { sanitizeAccessGuide } from "@/lib/properties/access-guide";
import { extractLaundryTeamUserIds } from "@/lib/laundry/teams";
import { describeLaundryTeam } from "@/lib/properties/laundry-team";
import { chargeForJob, loadChargeInputs } from "@/lib/jobs/list-row-extras";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import type { NewJobCleanerPay, NewJobPropertyFacts } from "./types";

/**
 * What the New job page fills in from the property, each value read by the
 * same rule the create, the invoice or the assignment would apply:
 *
 * - pay hours: `resolvePropertyCleanHours` (iCal and recurring use it too);
 * - client price: `computeClientCharge` via the Jobs list's own inputs
 *   (property rate, then price book), read again when the job is invoiced;
 * - cleaner pay: `resolveAssignmentPayRate` for the preferred cleaner (the
 *   snapshot the auto-offer would write), else the property's own rate;
 * - cleaner form: `resolveJobFormTemplate` (property override, else the
 *   newest active one for the type).
 *
 * Missing values stay null; nothing here writes.
 */
export async function loadNewJobPropertyFacts(propertyId: string, jobType: JobType): Promise<NewJobPropertyFacts | null> {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true, name: true, address: true, suburb: true, isActive: true, imageUrl: true, bedrooms: true, bathrooms: true,
      sofaBedCount: true, hasBalcony: true, laundryEnabled: true, inventoryEnabled: true, defaultCheckinTime: true,
      defaultCheckoutTime: true, keyLostMode: true, assignedCleaningHours: true, cleaningDurationMinutes: true,
      accessInfo: true, accessGuide: true, keyLocation: true, laundryBagLabel: true, laundryBagColor: true,
      cleanerServiceRate: true, preferredCleanerUserId: true,
      client: { select: { id: true, name: true } },
      integration: { select: { isEnabled: true, provider: true, lastSyncAt: true, syncStatus: true, syncError: true, icalUrl: true } },
    },
  });
  if (!property) return null;

  const [settings, templates, chargeInputs, carryForward, preferred, laundryTeam, recentJobs] = await Promise.all([
    getAppSettings(),
    db.formTemplate.findMany({
      where: { isActive: true, serviceType: jobType },
      select: { id: true, name: true, serviceType: true, isActive: true, version: true, isJobScoped: true, createdAt: true, updatedAt: true },
    }),
    loadChargeInputs([{ jobType, propertyId }]),
    db.jobTask.findMany({
      where: { propertyId, source: "CARRY_FORWARD", jobId: null, executionStatus: "OPEN" },
      select: { title: true },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
    property.preferredCleanerUserId
      ? db.user.findFirst({
          where: { id: property.preferredCleanerUserId },
          select: { id: true, name: true, email: true, isActive: true },
        })
      : Promise.resolve(null),
    describeLaundryTeam(extractLaundryTeamUserIds(property.accessInfo)),
    db.job.findMany({ where: { propertyId }, orderBy: { scheduledDate: "desc" }, take: 20, select: { internalNotes: true } }),
  ]);
  const recentTaskTitles: string[] = [];
  for (const job of recentJobs) {
    for (const task of parseJobInternalNotes(job.internalNotes).specialRequestTasks) {
      const title = task.title.trim();
      if (title && !recentTaskTitles.includes(title)) recentTaskTitles.push(title);
    }
    if (recentTaskTitles.length >= 6) break;
  }

  const preferredIsCleaner = preferred
    ? Boolean(await db.user.findFirst({ where: { id: preferred.id, isActive: true, ...holdsRoleWhere("CLEANER") }, select: { id: true } }))
    : false;

  const resolved = resolveJobFormTemplate({ jobType, propertyId, overrides: settings.propertyFormTemplateOverrides, templates });
  const form = resolved.template && (resolved.source === "property_override" || resolved.source === "global_latest")
    ? { name: resolved.template.name, version: resolved.template.version, source: resolved.source }
    : null;

  const charge = chargeForJob({ jobType, propertyId, fixedPrice: null }, chargeInputs);
  const preferredRate = preferred
    ? resolveAssignmentPayRate({
        perCleanerRate: settings.cleanerJobHourlyRates?.[preferred.id]?.[jobType],
        propertyCleanerServiceRate: property.cleanerServiceRate,
      })
    : null;
  const propertyRate = resolveAssignmentPayRate({ propertyCleanerServiceRate: property.cleanerServiceRate });
  const perCleaner = preferred ? settings.cleanerJobHourlyRates?.[preferred.id]?.[jobType] : null;
  const cleanerPay: NewJobCleanerPay = preferred && preferredRate !== null
    ? { rate: preferredRate, basis: perCleaner && perCleaner > 0 ? "preferred_cleaner_rate" : "property_rate" }
    : propertyRate !== null
      ? { rate: propertyRate, basis: "property_rate" }
      : { rate: null, basis: "none" };

  const guide = sanitizeAccessGuide(property.accessGuide);
  const integration = property.integration;

  return {
    property: {
      id: property.id,
      name: property.name,
      address: property.address,
      suburb: property.suburb,
      isActive: property.isActive,
      imageUrl: property.imageUrl,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      sofaBedCount: property.sofaBedCount,
      hasBalcony: property.hasBalcony,
      laundryEnabled: property.laundryEnabled !== false,
      inventoryEnabled: property.inventoryEnabled,
      defaultCheckinTime: property.defaultCheckinTime,
      defaultCheckoutTime: property.defaultCheckoutTime,
      keyLostMode: property.keyLostMode,
    },
    client: property.client ? { id: property.client.id, name: property.client.name } : null,
    laundry: {
      partnerNames: laundryTeam.map((member) => member.partnerName ?? member.name),
      bagLabel: property.laundryBagLabel,
      bagColor: property.laundryBagColor,
    },
    ical: integration && integration.icalUrl
      ? {
          enabled: integration.isEnabled,
          provider: integration.provider,
          lastSyncAt: integration.lastSyncAt ? integration.lastSyncAt.toISOString() : null,
          status: integration.syncStatus,
          error: integration.syncError,
        }
      : null,
    preferredCleaner: preferred
      ? { id: preferred.id, name: preferred.name?.trim() || preferred.email || "Cleaner", active: preferredIsCleaner }
      : null,
    hours: resolvePropertyCleanHours({
      assignedCleaningHours: property.assignedCleaningHours,
      cleaningDurationMinutes: property.cleaningDurationMinutes,
      accessInfo: property.accessInfo,
    }),
    clientPrice: { amount: charge.amount, source: charge.source, missing: charge.missing },
    cleanerPay,
    form,
    access: {
      hasGuide: guide.length > 0,
      guideEntries: guide.length,
      guidePhotos: guide.reduce((sum, entry) => sum + (entry.images?.length ?? 0), 0),
      keyLocation: property.keyLocation?.trim() || null,
    },
    carryForward: { count: carryForward.length, titles: carryForward.map((task) => task.title) },
    recentTaskTitles: recentTaskTitles.slice(0, 6),
  };
}
