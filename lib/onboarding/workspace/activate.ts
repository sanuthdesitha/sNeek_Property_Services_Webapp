import "server-only";
/**
 * Activate an onboarding (2026-11-16): the readiness step's "Activate
 * property". It goes through the EXISTING approval service
 * (`approveSurvey`, lib/onboarding/approval/workflow.ts), so everything that
 * creates today (client, property, geocode, encrypted codes, access guide,
 * calendar link, laundry, checklist profile and forms, default stock, first
 * jobs) still happens exactly as before. The workspace's own sections are
 * applied inside the same transaction through its `afterPropertyCreated`
 * hook, and the stock list replaces the whole default set only when one was
 * chosen. Safe to press twice: an activated survey returns what it created.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { approveSurvey, OnboardingValidationError, type ApproveResult } from "@/lib/onboarding/approval/workflow";
import { computeReadiness } from "./readiness";
import { editStateFromRow, loadSurveyRow, OnboardingWorkspaceError, readinessSnapshot } from "./service";
import type { OnboardingAccessKind, OnboardingWorkspaceData } from "./types";
import { sectionValues } from "./values";

export type ActivateInput = {
  surveyId: string;
  actorUserId: string;
  createInitialJobs: boolean;
  /** The revision the person saw on the readiness step; a newer one is refused (409). */
  baseRevision: number;
};

export type ActivateResult = ApproveResult & { warnings: string[] };

const GUIDE_KIND: Record<OnboardingAccessKind, string> = {
  LOCKBOX: "LOCKBOX",
  KEYS: "KEYS",
  ENTRY: "ENTRY",
  ALARM: "ALARM",
  PARKING: "PARKING",
  WIFI: "WIFI",
  OTHER: "OTHER",
};

const GUIDE_LABEL: Record<OnboardingAccessKind, string> = {
  LOCKBOX: "Lockbox",
  KEYS: "Keys",
  ENTRY: "Building entry",
  ALARM: "Alarm",
  PARKING: "Parking",
  WIFI: "Wifi",
  OTHER: "Access",
};

function jsonArray(value: Prisma.JsonValue | null): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) as Array<Record<string, unknown>>) : [];
}

function roomLines(workspace: OnboardingWorkspaceData): string[] {
  return workspace.rooms.list
    .filter((room) => room.name.trim() || room.beds.trim())
    .map((room) => [room.name.trim() || "Room", room.beds.trim(), room.notes.trim()].filter(Boolean).join(" · "));
}

/**
 * What the workspace adds to the property the approval just created. Only
 * fills what the approval leaves empty or does not know about; it never
 * replaces a code or a guide entry the approval wrote from earlier answers.
 * Codes go into the encrypted columns only, never into guide text.
 */
export async function applyWorkspaceToProperty(
  tx: Prisma.TransactionClient,
  propertyId: string,
  workspace: OnboardingWorkspaceData,
  jobTypes: readonly string[],
): Promise<string[]> {
  const warnings: string[] = [];
  const property = await tx.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: { notes: true, accessGuide: true, setupGuide: true, accessCode: true, alarmCode: true, keyLocation: true },
  });
  const data: Prisma.PropertyUpdateInput = {};

  const lockbox = workspace.access.find((entry) => entry.kind === "LOCKBOX" && entry.codeCipher);
  const alarm = workspace.access.find((entry) => entry.kind === "ALARM" && entry.codeCipher);
  if (lockbox && !property.accessCode) data.accessCode = lockbox.codeCipher;
  if (alarm && !property.alarmCode) data.alarmCode = alarm.codeCipher;
  const keyWhere = workspace.access.find((entry) => entry.kind === "KEYS" && entry.where.trim()) ?? workspace.access.find((entry) => entry.kind === "LOCKBOX" && entry.where.trim());
  if (keyWhere && !property.keyLocation) data.keyLocation = keyWhere.where.trim().slice(0, 190);

  const guide = jsonArray(property.accessGuide);
  for (const entry of workspace.access) {
    const instructions = entry.where.trim();
    const images = entry.photos.map((photo) => ({ url: photo.url, key: photo.key }));
    if (!instructions && images.length === 0) continue;
    guide.push({ id: `onb-${entry.id}`.slice(0, 64), kind: GUIDE_KIND[entry.kind], label: GUIDE_LABEL[entry.kind], ...(instructions ? { instructions: instructions.slice(0, 4000) } : {}), images });
  }
  if (workspace.houseRules.hazards.trim()) guide.push({ id: "onb-hazards", kind: "OTHER", label: "Hazards", instructions: workspace.houseRules.hazards.trim().slice(0, 4000), images: [] });
  if (workspace.houseRules.buildingRules.trim()) guide.push({ id: "onb-building-rules", kind: "OTHER", label: "Building rules", instructions: workspace.houseRules.buildingRules.trim().slice(0, 4000), images: [] });
  if (guide.length > jsonArray(property.accessGuide).length) data.accessGuide = guide as unknown as Prisma.InputJsonValue;

  const setup = jsonArray(property.setupGuide);
  for (const photo of workspace.roomPhotos) {
    if (!photo.photo) continue;
    setup.push({
      id: `onb-${photo.id}`.slice(0, 64),
      kind: "REFERENCE_POSITION",
      label: (photo.room.trim() || "Room").slice(0, 120),
      ...(photo.caption.trim() ? { instructions: photo.caption.trim().slice(0, 4000) } : {}),
      images: [{ url: photo.photo.url, key: photo.photo.key, ...(photo.caption.trim() ? { caption: photo.caption.trim().slice(0, 280) } : {}) }],
    });
  }
  if (setup.length > jsonArray(property.setupGuide).length) data.setupGuide = setup as unknown as Prisma.InputJsonValue;

  const extraNotes = [
    roomLines(workspace).length ? `Rooms:\n${roomLines(workspace).join("\n")}` : null,
    workspace.houseRules.hazards.trim() ? `Hazards: ${workspace.houseRules.hazards.trim()}` : null,
    workspace.houseRules.buildingRules.trim() ? `Building rules: ${workspace.houseRules.buildingRules.trim()}` : null,
  ].filter((part): part is string => Boolean(part));
  if (extraNotes.length) data.notes = [property.notes, ...extraNotes].filter(Boolean).join("\n");

  if (workspace.clockInRadiusM !== null) data.geofenceRadiusM = workspace.clockInRadiusM;
  if (workspace.rooms.sofaBeds !== null) data.sofaBedCount = workspace.rooms.sofaBeds;
  if (workspace.laundry.bagLabel.trim()) data.laundryBagLabel = workspace.laundry.bagLabel.trim();
  if (workspace.laundry.bagColor.trim()) data.laundryBagColor = workspace.laundry.bagColor.trim();
  data.jobTimeSource = workspace.jobTimeSource;

  const main = jobTypes[0];
  const mainRate = workspace.rates.find((rate) => rate.jobType === main);
  if (mainRate && mainRate.cleanerPayMode === "PER_CLEAN" && typeof mainRate.cleanerPay === "number") data.cleanerServiceRate = mainRate.cleanerPay;
  if (workspace.rates.some((rate) => rate.cleanerPayMode === "HOURLY" && typeof rate.cleanerPay === "number")) {
    warnings.push("Hourly cleaner pay is not stored on the property; the cleaner's own pay rate applies.");
  }

  await tx.property.update({ where: { id: propertyId }, data });

  for (const rate of workspace.rates) {
    if (!jobTypes.includes(rate.jobType) || typeof rate.clientRate !== "number" || rate.clientRate <= 0) continue;
    await tx.propertyClientRate.upsert({
      where: { propertyId_jobType: { propertyId, jobType: rate.jobType as never } },
      create: { propertyId, jobType: rate.jobType as never, baseCharge: rate.clientRate, billingUnit: rate.billingUnit, isActive: true },
      update: {},
    });
  }
  return warnings;
}

export async function activateOnboarding(input: ActivateInput): Promise<ActivateResult> {
  const row = await loadSurveyRow(db, input.surveyId);
  if (!row) throw new OnboardingWorkspaceError(404, "This onboarding no longer exists.");
  if (row.status === "APPROVED") {
    const repeat = await approveSurvey({ surveyId: row.id, adminReviewerId: input.actorUserId });
    return { ...repeat, warnings: repeat.coverageWarnings ?? [] };
  }
  if (row.status === "REJECTED") throw new OnboardingWorkspaceError(409, "This onboarding was rejected and cannot be activated.");
  if (row.revision !== input.baseRevision) {
    throw new OnboardingWorkspaceError(409, "Someone changed this onboarding after you opened the readiness check. Look at it again before activating.", { revision: row.revision });
  }
  const state = editStateFromRow(row);
  const readiness = computeReadiness(readinessSnapshot(row, state));
  if (!readiness.ready) {
    throw new OnboardingWorkspaceError(422, `Not ready to activate: ${readiness.missingRequired.map((item) => `${item.label} (${item.detail})`).join("; ")}.`, {
      missing: readiness.missingRequired.map((item) => item.key),
    });
  }

  // The approval needs a submitted survey. Submit it here (as the old Submit
  // button did) and put it back to draft if the approval refuses.
  let submittedHere = false;
  if (row.status === "DRAFT") {
    const moved = await db.propertyOnboardingSurvey.updateMany({ where: { id: row.id, status: "DRAFT", revision: input.baseRevision }, data: { status: "PENDING_REVIEW", submittedAt: new Date() } });
    if (moved.count !== 1) throw new OnboardingWorkspaceError(409, "This onboarding changed while activating. Look at it again.");
    submittedHere = true;
  }

  const jobTypes = sectionValues(state).scope.selectedJobTypes;
  const hookWarnings: string[] = [];
  const stockList = state.workspace.stock.rows.length ? state.workspace.stock.rows.map((stockRow) => ({ sku: stockRow.sku, parLevel: stockRow.parLevel, reorderAt: stockRow.reorderAt })) : undefined;
  let result: ApproveResult;
  try {
    result = await approveSurvey({
      surveyId: row.id,
      adminReviewerId: input.actorUserId,
      createInitialJobs: input.createInitialJobs,
      stockList,
      afterPropertyCreated: async (tx, created) => {
        hookWarnings.push(...(await applyWorkspaceToProperty(tx, created.propertyId, state.workspace, jobTypes)));
      },
    });
  } catch (error) {
    if (submittedHere) {
      await db.propertyOnboardingSurvey.updateMany({ where: { id: row.id, status: "PENDING_REVIEW", createdPropertyId: null }, data: { status: "DRAFT", submittedAt: null } });
    }
    if (error instanceof OnboardingValidationError) throw new OnboardingWorkspaceError(422, error.message);
    throw error;
  }
  const warnings = [...(result.coverageWarnings ?? []), ...hookWarnings];
  await db.auditLog.create({
    data: {
      userId: input.actorUserId,
      action: "ONBOARDING_ACTIVATED",
      entity: "PropertyOnboardingSurvey",
      entityId: row.id,
      after: { propertyId: result.propertyId ?? null, createInitialJobs: input.createInitialJobs, jobIds: result.jobIds, warnings, revision: row.revision } as Prisma.InputJsonValue,
    },
  });
  // Keep every warning on the onboarding so the activated result can show it later.
  const fresh = await db.propertyOnboardingSurvey.findUnique({ where: { id: row.id }, select: { adminNotes: true } });
  const recorded = fresh?.adminNotes ?? "";
  const missingFromNotes = warnings.filter((warning) => !recorded.includes(warning));
  if (missingFromNotes.length) {
    await db.propertyOnboardingSurvey.update({
      where: { id: row.id },
      data: { adminNotes: [recorded, ...missingFromNotes.map((warning) => `⚠ ${warning}`)].filter(Boolean).join("\n\n") },
    });
  }
  return { ...result, warnings };
}
