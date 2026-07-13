import { db } from "@/lib/db";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { geocodeAddress } from "@/lib/jobs/eta";
import { encryptSecret } from "@/lib/security/encryption";
import { readFormMeta, readAdminOverrides, type OnboardingFormMeta } from "@/lib/onboarding/form-meta";
import { getChecklistLibrary, seedChecklistLibraryFromCatalog } from "@/lib/checklists/library";
import {
  buildDefaultSelections,
  generatePropertyTemplates,
  mergeSelections,
  sanitizeSelections,
  type ProfileCustomItem,
} from "@/lib/checklists/compose";
import { featuresFromAppliances, sanitizeFeatures } from "@/lib/checklists/features";
import { logger } from "@/lib/logger";

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
  /** Non-fatal warnings, e.g. a selected job type produced no checklist form. */
  coverageWarnings?: string[];
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

/**
 * Structured laundry JSON for `Property.laundryDetail`, built from the survey's
 * OnboardingLaundryDetail child (previously only its `hasLaundry` boolean was
 * read). Returns null when there's no laundry row or nothing meaningful to store.
 */
function buildLaundryDetailJson(survey: SurveyWithChildren): Record<string, unknown> | null {
  const ld = survey.laundryDetail;
  if (!ld) return null;
  const out: Record<string, unknown> = {};
  if (ld.hasLaundry != null) out.hasLaundry = ld.hasLaundry;
  if (ld.washerType) out.washerType = ld.washerType;
  if (ld.dryerType) out.dryerType = ld.dryerType;
  if (ld.laundryLocation) out.laundryLocation = ld.laundryLocation;
  if (ld.detergentType) out.detergentType = ld.detergentType;
  if (ld.suppliesProvided != null) out.suppliesProvided = ld.suppliesProvided;
  if (typeof ld.notes === "string" && ld.notes.trim()) out.notes = ld.notes.trim();
  // Only worth persisting when there's more than the default hasLaundry=false.
  const meaningful =
    ld.hasLaundry === true ||
    out.washerType ||
    out.dryerType ||
    out.laundryLocation ||
    out.detergentType ||
    out.suppliesProvided === true ||
    out.notes;
  return meaningful ? out : null;
}

/** Return a non-empty structured object from formMeta, else null. */
function nonEmptyObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return Object.keys(record).length > 0 ? record : null;
  }
  return null;
}

/**
 * Drive `Property.inventoryEnabled` from the wizard's consumables answers
 * instead of hardcoding false: the property is stock-managed when our team
 * restocks consumables. Defaults false when there's no signal.
 */
function deriveInventoryEnabled(scenarios: Record<string, unknown>): boolean {
  if (scenarios.consumablesProvided === true) return true;
  const restock = scenarios.restockExpectations ?? scenarios.restock;
  if (typeof restock === "string" && restock.trim()) return true;
  return false;
}

/**
 * Build the cleaner-facing `Property.accessGuide` from the survey access details
 * + entry-photo annotations (+ scenario wifi/bins). Matches the canonical entry
 * shape validated by the access-guide route:
 *   { id, kind, label, instructions?, images: [{ url, key, caption? }] }
 * so cleaners see a populated Access Guide straight from onboarding.
 */
function buildAccessGuide(
  survey: SurveyWithChildren,
  meta: OnboardingFormMeta
): Array<Record<string, unknown>> {
  const scenarios = (meta.scenarios ?? {}) as Record<string, unknown>;
  const entries: Array<Record<string, unknown>> = [];

  const KIND_BY_DETAIL: Record<string, { kind: string; label: string }> = {
    LOCKBOX: { kind: "LOCKBOX", label: "Lockbox" },
    KEY_LOCATION: { kind: "KEYS", label: "Key location" },
    PARKING: { kind: "PARKING", label: "Parking" },
    BUILDING_ACCESS: { kind: "ENTRY", label: "Building access" },
    ENTRY_PHOTO: { kind: "ENTRY", label: "Entry" },
  };

  let seq = 0;
  for (const detail of survey.accessDetails) {
    const map = KIND_BY_DETAIL[detail.detailType];
    if (!map) continue;
    const value = (detail.value ?? "").trim();
    // Photo annotations ([{ x, y, text }]) → a caption for the entry photo.
    const annotations = Array.isArray(detail.annotations) ? (detail.annotations as unknown[]) : [];
    const annotationText = annotations
      .map((a) =>
        a && typeof a === "object" ? String((a as Record<string, unknown>).text ?? "").trim() : ""
      )
      .filter(Boolean)
      .join(" • ");

    const images: Array<Record<string, unknown>> = [];
    // The access-guide schema requires BOTH url + key on an image; only add when both present.
    if (detail.photoUrl && detail.photoKey) {
      const caption = (annotationText || value || "").slice(0, 280);
      images.push({
        url: detail.photoUrl,
        key: detail.photoKey,
        ...(caption ? { caption } : {}),
      });
    }

    const instructions = (value || annotationText || "").slice(0, 4000);
    // Skip entries that would carry nothing useful.
    if (!instructions && images.length === 0) continue;

    entries.push({
      id: (detail.id || `access-${++seq}`).slice(0, 64),
      kind: map.kind,
      label: map.label,
      ...(instructions ? { instructions } : {}),
      images,
    });
  }

  // Fold scenario wifi + bins into the guide where sensible (allowed kinds).
  if (scenarios.wifiNetwork || scenarios.wifiPassword) {
    const instructions = [
      scenarios.wifiNetwork ? `Network: ${scenarios.wifiNetwork}` : null,
      scenarios.wifiPassword ? `Password: ${scenarios.wifiPassword}` : null,
    ]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 4000);
    if (instructions) {
      entries.push({ id: "access-wifi", kind: "WIFI", label: "Wifi", instructions, images: [] });
    }
  }
  if (scenarios.binDay || scenarios.binNotes) {
    const instructions = [
      scenarios.binDay ? `Day: ${scenarios.binDay}` : null,
      scenarios.binNotes ? String(scenarios.binNotes) : null,
    ]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 4000);
    if (instructions) {
      entries.push({ id: "access-bins", kind: "BIN_ROOM", label: "Bins", instructions, images: [] });
    }
  }

  return entries;
}

/**
 * Special requests → checklist custom items (ProfileCustomItem shape the compose
 * lib expects). Priority + area are folded into the label/instructions, and
 * HIGH/URGENT requests demand a proof photo. Ids are stable so re-approval stays
 * idempotent.
 */
function specialRequestCustomItems(survey: SurveyWithChildren): ProfileCustomItem[] {
  return survey.specialRequests
    .filter((r) => typeof r.description === "string" && r.description.trim())
    .map((r, idx) => {
      const description = r.description.trim();
      const label = (r.area ? `${r.area}: ${description}` : description).slice(0, 120);
      const instructions = [
        r.priority && r.priority !== "NORMAL" ? `Priority: ${r.priority}` : null,
        r.area ? `Area: ${r.area}` : null,
        description.length > 120 || r.area ? description : null,
      ]
        .filter(Boolean)
        .join(" • ");
      return {
        id: `sr-${r.id || idx}`.slice(0, 64),
        label,
        ...(instructions ? { instructions } : {}),
        ...(r.priority === "HIGH" || r.priority === "URGENT" ? { requiresPhoto: true } : {}),
      };
    });
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

  // ── Dropped-input recovery: structured property attributes ─────────────────
  // These were captured/validated on the survey but never landed on the Property
  // (columns now exist). All reads guarded so old surveys stay backward-compatible.
  const propertyType =
    typeof survey.propertyType === "string" && survey.propertyType.trim()
      ? survey.propertyType.trim()
      : null;
  const sizeSqm = typeof survey.sizeSqm === "number" ? survey.sizeSqm : null;
  const floorCount = typeof survey.floorCount === "number" ? survey.floorCount : null;
  const laundryDetailJson = buildLaundryDetailJson(survey);
  const emergencyContactJson = nonEmptyObject(meta.emergencyContact);
  const recurringScheduleJson = nonEmptyObject(meta.recurringSchedule);
  const accessGuide = buildAccessGuide(survey, meta);
  const inventoryEnabled = deriveInventoryEnabled(scenarios);

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

  // ── Post-step: per-property checklist (best-effort, never blocks approval) ──
  // Copies the amenity features onto the property, saves the checklist profile
  // (from the wizard's Checklist step if reviewed, else library defaults), and
  // generates the property-specific form templates for the selected job types.
  const coverageWarnings: string[] = [];
  try {
    const checklistOverride =
      overrides.checklist && typeof overrides.checklist === "object"
        ? (overrides.checklist as Record<string, unknown>)
        : null;
    const features = {
      ...featuresFromAppliances(survey.appliances ?? []),
      // hasPets → petFriendly so the pet-hair checklist section is included.
      // Applied BEFORE the admin's explicit override so a deliberate toggle wins.
      ...(scenarios.hasPets === true ? { petFriendly: true } : {}),
      ...sanitizeFeatures(checklistOverride?.features),
    };
    await db.property.update({
      where: { id: result.propertyId },
      data: { features: features as Prisma.InputJsonValue },
    });

    let library = await getChecklistLibrary();
    if (library.length === 0) {
      await seedChecklistLibraryFromCatalog();
      library = await getChecklistLibrary();
    }
    const propertyForRules = await db.property.findUnique({
      where: { id: result.propertyId },
      select: {
        hasBalcony: true,
        bedrooms: true,
        bathrooms: true,
        laundryEnabled: true,
        inventoryEnabled: true,
        features: true,
      },
    });
    if (propertyForRules) {
      const defaults = buildDefaultSelections(library, propertyForRules);
      const saved = checklistOverride?.selections
        ? sanitizeSelections(checklistOverride.selections)
        : null;
      const selections = saved ? mergeSelections(defaults, saved) : defaults;

      // Special requests → custom checklist tasks (deduped by id so re-approval
      // is idempotent). HIGH/URGENT requests require a proof photo.
      const requestItems = specialRequestCustomItems(survey);
      if (requestItems.length > 0) {
        const existingIds = new Set(selections.customItems.map((c) => c.id));
        for (const item of requestItems) {
          if (!existingIds.has(item.id)) selections.customItems.push(item);
        }
      }

      await db.propertyChecklistProfile.upsert({
        where: { propertyId: result.propertyId },
        create: {
          propertyId: result.propertyId,
          selections: selections as unknown as Prisma.InputJsonValue,
          status: "DRAFT",
        },
        update: {
          selections: selections as unknown as Prisma.InputJsonValue,
        },
      });
      const templateJobTypes = requestedJobTypes.filter((jobType): jobType is JobType =>
        Object.values(JobType).includes(jobType as JobType)
      );
      if (templateJobTypes.length > 0) {
        const { generated } = await generatePropertyTemplates({
          propertyId: result.propertyId,
          jobTypes: templateJobTypes,
          actorUserId: input.adminReviewerId,
        });
        // Coverage check: warn (non-fatal) if a selected job type produced no form
        // so approval never silently leaves a service without a checklist.
        const covered = new Set(Object.keys(generated));
        const uncovered = templateJobTypes.filter((jobType) => !covered.has(jobType));
        if (uncovered.length > 0) {
          const warning = `No checklist form was generated for: ${uncovered
            .map((jt) => jt.replace(/_/g, " ").toLowerCase())
            .join(", ")}. Set these up from the property's Forms tab.`;
          coverageWarnings.push(warning);
          logger.warn(
            { surveyId: survey.id, propertyId: result.propertyId, uncovered },
            "Onboarding approval: selected job type(s) produced no checklist form"
          );
          const currentNotes = input.adminNotes ?? survey.adminNotes ?? "";
          await db.propertyOnboardingSurvey.update({
            where: { id: survey.id },
            data: {
              adminNotes: [currentNotes, `⚠ ${warning}`].filter(Boolean).join("\n\n"),
            },
          });
        }
      }
    }
  } catch (err) {
    logger.error(
      { err, surveyId: survey.id, propertyId: result.propertyId },
      "Onboarding checklist materialisation failed (non-fatal — set it up from the property's Forms tab)"
    );
  }

  return {
    ok: true,
    alreadyApproved: false,
    ...result,
    ...(coverageWarnings.length ? { coverageWarnings } : {}),
  };

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
        // Structured attributes recovered from the survey (previously dropped).
        propertyType: propertyType ?? undefined,
        sizeSqm: sizeSqm ?? undefined,
        floorCount: floorCount ?? undefined,
        laundryDetail: laundryDetailJson
          ? (laundryDetailJson as Prisma.InputJsonValue)
          : undefined,
        emergencyContact: emergencyContactJson
          ? (emergencyContactJson as Prisma.InputJsonValue)
          : undefined,
        recurringSchedule: recurringScheduleJson
          ? (recurringScheduleJson as Prisma.InputJsonValue)
          : undefined,
        // Keep accessInfo for back-compat AND populate the rich cleaner Access Guide.
        accessInfo: accessInfo as Prisma.InputJsonValue,
        accessGuide: accessGuide.length ? (accessGuide as unknown as Prisma.InputJsonValue) : undefined,
        accessCode,
        alarmCode,
        keyLocation,
        latitude: lat ?? undefined,
        longitude: lng ?? undefined,
        placeId: placeId ?? undefined,
        defaultCheckinTime: checkinTime,
        defaultCheckoutTime: checkoutTime,
        linenBufferSets,
        inventoryEnabled,
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
