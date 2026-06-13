import { db } from "@/lib/db";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { geocodeAddress } from "@/lib/jobs/eta";
import { encryptSecret } from "@/lib/security/encryption";
import { readFormMeta, readAdminOverrides, type OnboardingFormMeta } from "@/lib/onboarding/form-meta";

interface ApproveInput {
  surveyId: string;
  adminReviewerId: string;
  adminNotes?: string | null;
  adminOverrides?: Record<string, unknown> | null;
  createJobsForTypes?: string[];
  /** When false, no Job drafts are created (property/integration/laundry only). */
  createInitialJobs?: boolean;
}

export interface ApproveResult {
  ok: true;
  alreadyApproved: boolean;
  clientId?: string;
  propertyId?: string;
  integrationId?: string;
  laundryTaskId?: string;
  jobIds: string[];
}

/** Thrown when the survey is missing required data to create real entities. */
export class OnboardingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingValidationError";
  }
}

type SurveyWithChildren = Prisma.PropertyOnboardingSurveyGetPayload<{
  include: {
    appliances: true;
    specialRequests: true;
    laundryDetail: true;
    accessDetails: true;
    jobTypeAnswers: true;
    existingClient: true;
  };
}>;

const HH_MM = /^\d{2}:\d{2}$/;

/**
 * Validate that a survey has everything required to create a Client + Property
 * on approval. Returns a list of human-readable problems (empty = OK). This is
 * exposed so the API/UI can surface errors before the admin clicks Approve.
 */
export function validateSurveyForApproval(survey: SurveyWithChildren): string[] {
  const errors: string[] = [];

  // Client branch must be resolvable.
  if (survey.isNewClient) {
    const data = (survey.clientData ?? {}) as Record<string, unknown>;
    if (!data.name || !String(data.name).trim()) {
      errors.push("New client is selected but no client name was provided.");
    }
  } else if (!survey.existingClientId) {
    errors.push("No client linked: pick an existing client or create a new one.");
  }

  // Property essentials.
  if (!survey.propertyAddress || !survey.propertyAddress.trim()) {
    errors.push("Property address is required.");
  }
  if (!survey.propertySuburb || !survey.propertySuburb.trim()) {
    errors.push("Property suburb is required (used for scheduling + routing).");
  }
  if (survey.bedrooms == null || survey.bedrooms < 0) errors.push("Bedrooms must be 0 or more.");
  if (survey.bathrooms == null || survey.bathrooms < 0) errors.push("Bathrooms must be 0 or more.");

  return errors;
}

/**
 * Build the property `accessInfo` JSON + encrypted code/key fields from the
 * survey's access details and scenario blob. Mirrors the admin property route
 * so codes are encrypted at rest, not stored as plaintext JSON.
 */
function buildAccessInfo(survey: SurveyWithChildren, meta: OnboardingFormMeta) {
  const scenarios = (meta.scenarios ?? {}) as Record<string, unknown>;
  const accessInfo: Record<string, unknown> = {};
  const attachments: Record<string, unknown>[] = [];

  let lockboxOrKey = "";
  let codeValue = "";

  for (const detail of survey.accessDetails) {
    const value = (detail.value ?? "").trim();
    if (detail.detailType === "LOCKBOX") {
      accessInfo.lockbox = value;
      codeValue = codeValue || value;
    } else if (detail.detailType === "KEY_LOCATION") {
      accessInfo.keyLocation = value;
      lockboxOrKey = lockboxOrKey || value;
    } else if (detail.detailType === "PARKING") {
      accessInfo.parking = value;
    } else if (detail.detailType === "BUILDING_ACCESS") {
      accessInfo.instructions = value;
    } else if (detail.detailType === "ENTRY_PHOTO" && detail.photoKey) {
      attachments.push({ name: "onboarding_photo", url: detail.photoUrl, key: detail.photoKey });
    }
  }
  if (attachments.length > 0) accessInfo.attachments = attachments;

  // Fold scenario-level access/parking notes in.
  if (typeof scenarios.parkingInstructions === "string" && scenarios.parkingInstructions.trim()) {
    accessInfo.parking = [accessInfo.parking, scenarios.parkingInstructions]
      .filter((v) => typeof v === "string" && v.trim())
      .join(" — ");
  }
  if (typeof scenarios.noGoAreas === "string" && scenarios.noGoAreas.trim()) {
    accessInfo.noGoAreas = scenarios.noGoAreas.trim();
  }
  if (scenarios.wifiNetwork || scenarios.wifiPassword) {
    accessInfo.wifi = { network: scenarios.wifiNetwork ?? null, password: scenarios.wifiPassword ?? null };
  }
  if (scenarios.hasPets) {
    accessInfo.pets = scenarios.petDetails ?? true;
  }
  if (scenarios.binDay || scenarios.binNotes) {
    accessInfo.bins = { day: scenarios.binDay ?? null, notes: scenarios.binNotes ?? null };
  }

  const keyLocation =
    lockboxOrKey || (typeof accessInfo.lockbox === "string" ? (accessInfo.lockbox as string) : "");
  const alarmCode = typeof scenarios.alarmCode === "string" ? scenarios.alarmCode : "";

  return {
    accessInfo,
    keyLocation: keyLocation || null,
    accessCode: encryptSecret(codeValue || null),
    alarmCode: encryptSecret(alarmCode || null),
  };
}

/** Build a consolidated property notes blob from scenario + free-text fields. */
function buildPropertyNotes(survey: SurveyWithChildren, meta: OnboardingFormMeta): string | null {
  const scenarios = (meta.scenarios ?? {}) as Record<string, unknown>;
  const parts: (string | null | undefined)[] = [
    survey.propertyNotes,
    scenarios.bedConfig ? `Beds: ${scenarios.bedConfig}` : null,
    scenarios.specialNotes ? String(scenarios.specialNotes) : null,
    scenarios.timingInstructions ? `Timing: ${scenarios.timingInstructions}` : null,
    scenarios.consumablesNotes ? `Consumables: ${scenarios.consumablesNotes}` : null,
    scenarios.restockExpectations ? `Restock: ${scenarios.restockExpectations}` : null,
    scenarios.linenNotes ? `Linen: ${scenarios.linenNotes}` : null,
    scenarios.petDetails && scenarios.hasPets ? `Pets: ${scenarios.petDetails}` : null,
    scenarios.alarmNotes ? `Alarm: ${scenarios.alarmNotes}` : null,
  ];
  const joined = parts.filter((p) => typeof p === "string" && p.trim()).join("\n");
  return joined.trim() || null;
}

export async function approveSurvey(input: ApproveInput): Promise<ApproveResult> {
  const loaded = await db.propertyOnboardingSurvey.findUnique({
    where: { id: input.surveyId },
    include: {
      appliances: true,
      specialRequests: true,
      laundryDetail: true,
      accessDetails: { orderBy: { sortOrder: "asc" } },
      jobTypeAnswers: true,
      existingClient: true,
    },
  });

  if (!loaded) throw new OnboardingValidationError("Survey not found.");
  // Non-null binding so the narrowing survives inside the nested transaction.
  const survey: SurveyWithChildren = loaded;

  // ── Idempotency guard ──────────────────────────────────────────────
  // If the survey is already APPROVED and a property was created, never
  // re-create. Return the previously created ids so a double-click / retry is
  // a no-op rather than a duplicate Client/Property/Job set.
  if (survey.status === "APPROVED" && survey.createdPropertyId) {
    return {
      ok: true,
      alreadyApproved: true,
      clientId: survey.createdClientId ?? undefined,
      propertyId: survey.createdPropertyId ?? undefined,
      integrationId: survey.createdIntegrationId ?? undefined,
      laundryTaskId: survey.createdLaundryTaskId ?? undefined,
      jobIds: survey.createdJobIds ?? [],
    };
  }

  if (survey.status !== "PENDING_REVIEW") {
    throw new OnboardingValidationError(
      `Survey must be pending review to approve (current status: ${survey.status}).`,
    );
  }

  // ── Pre-flight validation ──────────────────────────────────────────
  const problems = validateSurveyForApproval(survey);
  if (problems.length > 0) {
    throw new OnboardingValidationError(problems.join(" "));
  }

  const meta = readFormMeta(survey.adminOverrides);
  // Merge any newly-supplied admin overrides over what was saved on the survey,
  // preserving the formMeta envelope.
  const savedAdminOverrides = readAdminOverrides(survey.adminOverrides);
  const overrides = { ...savedAdminOverrides, ...(input.adminOverrides ?? {}) } as Record<string, unknown>;

  // Resolve which job types to create drafts for.
  const metaJobTypes = Array.isArray(meta.selectedJobTypes) ? meta.selectedJobTypes : [];
  const answerJobTypes = survey.jobTypeAnswers.map((a) => a.jobType as string);
  const requestedJobTypes =
    input.createJobsForTypes ?? (metaJobTypes.length ? metaJobTypes : answerJobTypes);
  const createInitialJobs = input.createInitialJobs !== false;

  // ── Geocode the property address (reuses the shared Google geocode) ──
  // Prefer the lat/lng captured from the address autocomplete; fall back to a
  // server-side geocode so the property always gets coordinates for maps/GPS.
  let lat: number | null =
    typeof meta.propertyLatitude === "number" ? meta.propertyLatitude : null;
  let lng: number | null =
    typeof meta.propertyLongitude === "number" ? meta.propertyLongitude : null;
  const placeId = typeof meta.propertyPlaceId === "string" ? meta.propertyPlaceId : null;

  if ((lat == null || lng == null) && survey.propertyAddress) {
    const query = [survey.propertyAddress, survey.propertySuburb, survey.propertyState, survey.propertyPostcode]
      .filter(Boolean)
      .join(", ");
    const geo = await geocodeAddress(query);
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
    }
  }

  const { accessInfo, keyLocation, accessCode, alarmCode } = buildAccessInfo(survey, meta);
  const propertyNotes = buildPropertyNotes(survey, meta);
  const scenarios = (meta.scenarios ?? {}) as Record<string, unknown>;

  const linenBufferSets =
    typeof scenarios.linenBufferSets === "number" ? scenarios.linenBufferSets : 0;
  const checkinTime = HH_MM.test(String(meta.defaultCheckinTime ?? "")) ? String(meta.defaultCheckinTime) : "14:00";
  const checkoutTime = HH_MM.test(String(meta.defaultCheckoutTime ?? "")) ? String(meta.defaultCheckoutTime) : "10:00";

  // ── Transaction: client → property → integration → laundry → jobs ──
  let result;
  try {
    result = await runApprovalTransaction();
  } catch (err) {
    // A racing concurrent approval committed first — treat as idempotent no-op.
    if (err instanceof OnboardingValidationError && err.message === "__ALREADY_APPROVED__") {
      const after = await db.propertyOnboardingSurvey.findUnique({ where: { id: survey.id } });
      return {
        ok: true,
        alreadyApproved: true,
        clientId: after?.createdClientId ?? undefined,
        propertyId: after?.createdPropertyId ?? undefined,
        integrationId: after?.createdIntegrationId ?? undefined,
        laundryTaskId: after?.createdLaundryTaskId ?? undefined,
        jobIds: after?.createdJobIds ?? [],
      };
    }
    throw err;
  }

  return { ok: true, alreadyApproved: false, ...result };

  async function runApprovalTransaction() {
    return db.$transaction(async (tx) => {
    // Re-read the survey row inside the transaction to defend against a racing
    // concurrent approval (two requests that both passed the status check).
    const fresh = await tx.propertyOnboardingSurvey.findUnique({
      where: { id: survey.id },
      select: { status: true, createdPropertyId: true },
    });
    if (!fresh) throw new OnboardingValidationError("Survey not found.");
    if (fresh.status === "APPROVED" || fresh.createdPropertyId) {
      throw new OnboardingValidationError("__ALREADY_APPROVED__");
    }

    // 1. Resolve / create the client.
    let clientId = survey.existingClientId;
    let createdClientId: string | undefined;
    if (survey.isNewClient && survey.clientData) {
      const data = survey.clientData as Record<string, unknown>;
      const newClient = await tx.client.create({
        data: {
          name: String(data.name ?? "").trim() || "New Client",
          email: data.email ? String(data.email) : null,
          phone: data.phone ? String(data.phone) : null,
          address: data.address ? String(data.address) : null,
          notes: data.notes ? String(data.notes) : null,
          suburb: data.suburb ? String(data.suburb) : null,
          state: data.state ? String(data.state) : null,
          postcode: data.postcode ? String(data.postcode) : null,
          latitude: typeof data.latitude === "number" ? data.latitude : undefined,
          longitude: typeof data.longitude === "number" ? data.longitude : undefined,
          placeId: data.placeId ? String(data.placeId) : undefined,
        },
      });
      clientId = newClient.id;
      createdClientId = newClient.id;
    }

    if (!clientId) throw new OnboardingValidationError("No client linked to survey.");

    // 2. Create the property (geocoded, encrypted codes).
    const property = await tx.property.create({
      data: {
        clientId,
        name: survey.propertyName ?? survey.propertyAddress ?? "New Property",
        address: survey.propertyAddress ?? "",
        suburb: survey.propertySuburb ?? "",
        state: survey.propertyState,
        postcode: survey.propertyPostcode,
        notes: propertyNotes,
        bedrooms: survey.bedrooms,
        bathrooms: survey.bathrooms,
        hasBalcony: survey.hasBalcony,
        accessInfo: accessInfo as Prisma.InputJsonValue,
        accessCode,
        alarmCode,
        keyLocation,
        latitude: lat ?? undefined,
        longitude: lng ?? undefined,
        placeId: placeId ?? undefined,
        defaultCheckinTime: checkinTime,
        defaultCheckoutTime: checkoutTime,
        linenBufferSets,
        inventoryEnabled: false,
        laundryEnabled: survey.laundryDetail?.hasLaundry ?? false,
        preferredCleanerUserId:
          typeof meta.preferredCleanerUserId === "string" ? meta.preferredCleanerUserId : undefined,
      },
    });

    // 3. Integration (iCal) — optional.
    let integrationId: string | undefined;
    if (survey.icalUrl) {
      const integration = await tx.integration.create({
        data: {
          propertyId: property.id,
          icalUrl: survey.icalUrl,
          provider: survey.icalProvider ?? "ICAL_OTHER",
          isEnabled: false,
          syncStatus: "IDLE",
        },
      });
      integrationId = integration.id;
    }

    // 4. Job drafts for the selected cleaning types.
    const jobIds: string[] = [];
    const estimatedHours =
      (typeof overrides.estimatedHours === "number" ? overrides.estimatedHours : undefined) ??
      survey.estimatedHours ??
      undefined;
    const fixedPrice =
      typeof overrides.fixedPrice === "number"
        ? overrides.fixedPrice
        : typeof overrides.estimatedPrice === "number"
          ? overrides.estimatedPrice
          : survey.estimatedPrice ?? undefined;
    const cleanerCount =
      (typeof overrides.cleanerCount === "number" ? overrides.cleanerCount : undefined) ??
      survey.estimatedCleanerCount ??
      survey.requestedCleanerCount;

    const specialRequestNotes = survey.specialRequests
      .map((r) => `[${r.priority}] ${r.area ? r.area + ": " : ""}${r.description}`)
      .join("\n");
    const applianceNotes = survey.appliances
      .filter((a) => a.requiresClean)
      .map((a) => `- ${a.applianceType}${a.conditionNote ? `: ${a.conditionNote}` : ""}`)
      .join("\n");
    const jobNotes = [
      input.adminNotes ?? survey.adminNotes,
      specialRequestNotes,
      applianceNotes ? `Special appliances to clean:\n${applianceNotes}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (createInitialJobs) {
      for (const jobType of requestedJobTypes) {
        if (!Object.values(JobType).includes(jobType as JobType)) continue;

        const jobNumber = await reserveJobNumber(tx);
        const job = await tx.job.create({
          data: {
            jobNumber,
            propertyId: property.id,
            jobType: jobType as JobType,
            status: JobStatus.UNASSIGNED,
            scheduledDate: new Date(),
            estimatedHours,
            fixedPrice: typeof fixedPrice === "number" ? fixedPrice : undefined,
            notes: jobNotes || null,
            internalNotes: JSON.stringify({
              source: "onboarding",
              surveyId: survey.id,
              surveyNumber: survey.surveyNumber,
              cleanerCount,
              recurringSchedule: meta.recurringSchedule ?? null,
              emergencyContact: meta.emergencyContact ?? null,
            }),
          },
        });
        jobIds.push(job.id);
      }
    }

    // 5. LaundryTask — only when laundry is enabled AND we have a job to anchor
    //    it to (LaundryTask.jobId is required + unique, so we never create one
    //    with an empty/placeholder jobId).
    let laundryTaskId: string | undefined;
    if (survey.laundryDetail?.hasLaundry && jobIds.length > 0) {
      const pickupDate = new Date();
      pickupDate.setDate(pickupDate.getDate() + 1);
      const dropoffDate = new Date(pickupDate);
      dropoffDate.setDate(dropoffDate.getDate() + 2);

      const laundryTask = await tx.laundryTask.create({
        data: {
          propertyId: property.id,
          jobId: jobIds[0],
          pickupDate,
          dropoffDate,
          status: "PENDING",
          supplierId: survey.laundrySupplierId || null,
        },
      });
      laundryTaskId = laundryTask.id;
    }

    // 6. Stamp the survey APPROVED with the created ids (idempotency record).
    await tx.propertyOnboardingSurvey.update({
      where: { id: survey.id },
      data: {
        status: "APPROVED",
        adminReviewerId: input.adminReviewerId,
        reviewedAt: new Date(),
        adminNotes: input.adminNotes ?? survey.adminNotes,
        adminOverrides: {
          ...savedAdminOverrides,
          ...(input.adminOverrides ?? {}),
          formMeta: meta,
        } as unknown as Prisma.InputJsonValue,
        createdClientId: clientId,
        createdPropertyId: property.id,
        createdIntegrationId: integrationId,
        createdLaundryTaskId: laundryTaskId,
        createdJobIds: jobIds,
      },
    });

      return { clientId, createdClientId, propertyId: property.id, integrationId, laundryTaskId, jobIds };
    });
  }
}

export async function rejectSurvey(surveyId: string, adminReviewerId: string, reason: string) {
  const existing = await db.propertyOnboardingSurvey.findUnique({
    where: { id: surveyId },
    select: { status: true },
  });
  if (!existing) throw new OnboardingValidationError("Survey not found.");
  if (existing.status === "APPROVED") {
    throw new OnboardingValidationError("Cannot reject an already-approved survey.");
  }

  await db.propertyOnboardingSurvey.update({
    where: { id: surveyId },
    data: {
      status: "REJECTED",
      adminReviewerId,
      reviewedAt: new Date(),
      rejectionReason: reason,
    },
  });
}
