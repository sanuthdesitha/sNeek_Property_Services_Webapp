import "server-only";
/**
 * Onboarding workspace service (2026-11-16): load a survey as the workspace
 * view, save one section with history and the stale-save notice, review a
 * code the client typed, and list the board with readiness.
 *
 * Every save locks the survey row, applies only the fields sent, bumps
 * `revision` and writes an `OnboardingAnswerRevision` (office or client,
 * codes as "[encrypted]"). A save made from an older revision is still kept;
 * when someone else changed the same section since, the answer names them so
 * the screen can show "changed by someone else".
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { readAdminOverrides, readFormMeta, type OnboardingFormMeta } from "@/lib/onboarding/form-meta";
import { RULES, ruleSentence } from "@/lib/scheduling-rules/registry";
import { loadSchedulingRuleBook } from "@/lib/scheduling-rules/store";
import { computeReadiness, type ReadinessSnapshot, type ReadinessSummary } from "./readiness";
import {
  CLIENT_SECTION_TO_STEP,
  isClientLinkSection,
  type ClientLinkSection,
  type OnboardingSectionKey,
} from "./sections";
import { readWorkspace, type OnboardingAnswerSource } from "./types";
import {
  applySectionPatch,
  sectionValues,
  setSkipped,
  type ApplyResult,
  type ClientDataValue,
  type SectionPatchMap,
  type SurveyEditState,
} from "./values";
import { SECTION_PATCH_SCHEMAS } from "./schemas";
import type {
  AnswerRevisionView,
  ClientLinkView,
  LaundryRulesView,
  OnboardingBoardResponse,
  OnboardingBoardRow,
  OnboardingBoardTab,
  OnboardingStatus,
  OnboardingWorkspaceView,
  SaveConflictView,
  WorkspaceSaveResponse,
} from "./view-types";

export class OnboardingWorkspaceError extends Error {
  constructor(readonly status: number, message: string, readonly detail?: Record<string, unknown>) {
    super(message);
  }
}

const SURVEY_INCLUDE = {
  appliances: true,
  specialRequests: true,
  laundryDetail: true,
  accessDetails: { orderBy: { sortOrder: "asc" as const } },
  existingClient: { select: { id: true, name: true, email: true, phone: true } },
  laundrySupplier: { select: { id: true, name: true } },
  submittedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.PropertyOnboardingSurveyInclude;

export type SurveyRow = Prisma.PropertyOnboardingSurveyGetPayload<{ include: typeof SURVEY_INCLUDE }>;

/** The survey id for an id or an OB number (the workspace URL uses the number). */
export async function resolveSurveyId(idOrNumber: string): Promise<string | null> {
  const value = idOrNumber.trim();
  if (!value || value.length > 64) return null;
  const row = await db.propertyOnboardingSurvey.findFirst({
    where: { OR: [{ id: value }, { surveyNumber: value }] },
    select: { id: true },
  });
  return row?.id ?? null;
}

function readClientData(raw: unknown): ClientDataValue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "");
  return { name: text("name"), email: text("email"), phone: text("phone"), address: text("address"), notes: text("notes") };
}

export function editStateFromRow(row: SurveyRow): SurveyEditState {
  const meta = readFormMeta(row.adminOverrides);
  const scenarios = (meta.scenarios ?? {}) as Record<string, unknown>;
  return {
    isNewClient: row.isNewClient,
    existingClientId: row.existingClientId,
    clientData: readClientData(row.clientData),
    propertyName: row.propertyName,
    propertyAddress: row.propertyAddress,
    propertySuburb: row.propertySuburb,
    propertyState: row.propertyState,
    propertyPostcode: row.propertyPostcode,
    propertyNotes: row.propertyNotes,
    propertyType: row.propertyType,
    floorCount: row.floorCount,
    sizeSqm: row.sizeSqm,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    hasBalcony: row.hasBalcony,
    estimatedCleanerCount: row.estimatedCleanerCount,
    estimatedHours: row.estimatedHours,
    icalUrl: row.icalUrl,
    icalProvider: row.icalProvider,
    laundrySupplierId: row.laundrySupplierId,
    meta,
    workspace: readWorkspace(row.workspace, typeof scenarios.bedConfig === "string" ? scenarios.bedConfig : null),
    appliances: row.appliances.map((a) => ({ applianceType: a.applianceType, conditionNote: a.conditionNote ?? "", requiresClean: a.requiresClean })),
    specialRequests: row.specialRequests.map((r) => ({
      description: r.description,
      priority: (["LOW", "NORMAL", "HIGH", "URGENT"].includes(r.priority) ? r.priority : "NORMAL") as "LOW" | "NORMAL" | "HIGH" | "URGENT",
      area: r.area ?? "",
    })),
    laundryDetail: row.laundryDetail
      ? {
          hasLaundry: row.laundryDetail.hasLaundry,
          washerType: row.laundryDetail.washerType,
          dryerType: row.laundryDetail.dryerType,
          laundryLocation: row.laundryDetail.laundryLocation,
          suppliesProvided: row.laundryDetail.suppliesProvided,
          detergentType: row.laundryDetail.detergentType,
          notes: row.laundryDetail.notes,
        }
      : null,
  };
}

function clientLabel(row: Pick<SurveyRow, "isNewClient" | "clientData" | "existingClient">): string | null {
  if (row.isNewClient) {
    const name = readClientData(row.clientData)?.name.trim();
    return name ? `${name} (new client)` : null;
  }
  return row.existingClient?.name ?? null;
}

function checklistReviewed(adminOverrides: unknown): boolean {
  const overrides = readAdminOverrides(adminOverrides);
  return Boolean(overrides.checklist && typeof overrides.checklist === "object");
}

export function readinessSnapshot(row: SurveyRow, state: SurveyEditState): ReadinessSnapshot {
  const values = sectionValues(state);
  const photoTotal = state.workspace.roomPhotos.length;
  return {
    clientLabel: clientLabel(row),
    propertyName: state.propertyName,
    address: state.propertyAddress,
    suburb: state.propertySuburb,
    hasPin: typeof state.meta.propertyLatitude === "number" && typeof state.meta.propertyLongitude === "number",
    jobTypes: values.scope.selectedJobTypes,
    access: values.access.entries,
    legacyAccessCount: row.accessDetails.filter((detail) => (detail.value ?? "").trim() || detail.photoKey).length,
    rates: state.workspace.rates,
    bedrooms: state.bedrooms,
    bathrooms: state.bathrooms,
    roomCount: state.workspace.rooms.list.length,
    laundryEnabled: values.laundry.hasLaundry,
    laundryPartnerName: row.laundrySupplier?.name ?? null,
    stockRowCount: state.workspace.stock.rows.length,
    checklistReviewed: checklistReviewed(row.adminOverrides),
    photoTotal,
    photoDone: state.workspace.roomPhotos.filter((photo) => photo.photo).length,
    hasCalendarLink: Boolean(state.icalUrl),
    houseRulesFilled: Boolean(state.workspace.houseRules.hazards.trim() || state.workspace.houseRules.buildingRules.trim()),
    skipped: state.workspace.skipped,
  };
}

export async function loadSurveyRow(client: Prisma.TransactionClient | typeof db, surveyId: string): Promise<SurveyRow | null> {
  return client.propertyOnboardingSurvey.findUnique({ where: { id: surveyId }, include: SURVEY_INCLUDE });
}

/** Writes the edited state back to the survey's own columns, envelope, workspace and child rows. */
async function writeState(tx: Prisma.TransactionClient, row: SurveyRow, result: ApplyResult, actor: SaveActor, now: Date, revision: number) {
  const { next, touched } = result;
  const overrides = row.adminOverrides && typeof row.adminOverrides === "object" && !Array.isArray(row.adminOverrides) ? (row.adminOverrides as Record<string, unknown>) : {};
  const data: Prisma.PropertyOnboardingSurveyUpdateInput = {
    isNewClient: next.isNewClient,
    existingClient: next.existingClientId ? { connect: { id: next.existingClientId } } : { disconnect: true },
    clientData: next.clientData ? (next.clientData as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    propertyName: next.propertyName,
    propertyAddress: next.propertyAddress,
    propertySuburb: next.propertySuburb,
    propertyState: next.propertyState,
    propertyPostcode: next.propertyPostcode,
    propertyNotes: next.propertyNotes,
    propertyType: next.propertyType,
    floorCount: next.floorCount,
    sizeSqm: next.sizeSqm,
    bedrooms: next.bedrooms,
    bathrooms: next.bathrooms,
    hasBalcony: next.hasBalcony,
    estimatedCleanerCount: next.estimatedCleanerCount,
    estimatedHours: next.estimatedHours,
    icalUrl: next.icalUrl,
    icalProvider: (next.icalProvider as Prisma.PropertyOnboardingSurveyUpdateInput["icalProvider"]) ?? undefined,
    laundrySupplier: next.laundrySupplierId ? { connect: { id: next.laundrySupplierId } } : { disconnect: true },
    adminOverrides: { ...overrides, formMeta: next.meta as OnboardingFormMeta } as unknown as Prisma.InputJsonValue,
    workspace: next.workspace as unknown as Prisma.InputJsonValue,
    revision,
    lastSavedAt: now,
    lastSavedById: actor.userId,
    lastSavedSource: actor.source,
  };
  if (touched.appliances) {
    data.appliances = { deleteMany: {}, create: next.appliances.map((a) => ({ applianceType: a.applianceType, conditionNote: a.conditionNote || null, requiresClean: a.requiresClean })) };
  }
  if (touched.specialRequests) {
    data.specialRequests = { deleteMany: {}, create: next.specialRequests.map((r) => ({ description: r.description, priority: r.priority, area: r.area || null })) };
  }
  if (touched.laundryDetail && next.laundryDetail) {
    const detail = next.laundryDetail;
    data.laundryDetail = { upsert: { create: detail, update: detail } };
  }
  await tx.propertyOnboardingSurvey.update({ where: { id: row.id }, data });
}

export type SaveActor = {
  source: OnboardingAnswerSource;
  /** The signed-in office user; null for a client link. */
  userId: string | null;
  clientLinkId: string | null;
};

export type SaveInput = {
  surveyId: string;
  section: OnboardingSectionKey;
  values: unknown;
  baseRevision: number;
  skipped?: boolean;
  actor: SaveActor;
  now?: Date;
};

async function actorNames(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name || user.email]));
}

function editableStatus(status: string): boolean {
  return status === "DRAFT" || status === "PENDING_REVIEW";
}

/**
 * Save one section. Validates the fields, locks the row, applies only what was
 * sent and records who changed what. Never refuses a stale save: it keeps the
 * edit and reports the other person's change on the same section.
 */
export async function saveWorkspaceSection(input: SaveInput): Promise<WorkspaceSaveResponse> {
  const schema = SECTION_PATCH_SCHEMAS[input.section];
  const parsed = schema.safeParse(input.values ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new OnboardingWorkspaceError(400, `Check ${[input.section, ...issue.path].join(".")}: ${issue.message}`);
  }
  const patch = parsed.data as SectionPatchMap[typeof input.section];
  const now = input.now ?? new Date();

  const outcome = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PropertyOnboardingSurvey" WHERE "id" = ${input.surveyId} FOR UPDATE`;
    const row = await loadSurveyRow(tx, input.surveyId);
    if (!row) throw new OnboardingWorkspaceError(404, "This onboarding no longer exists.");
    if (!editableStatus(row.status)) {
      throw new OnboardingWorkspaceError(409, row.status === "APPROVED" ? "This onboarding is activated; change the property instead." : "This onboarding was rejected and can no longer be changed.");
    }
    if (input.section === "client" && "existingClientId" in (patch as object)) {
      const clientId = (patch as { existingClientId?: string | null }).existingClientId;
      if (clientId && !(await tx.client.findUnique({ where: { id: clientId }, select: { id: true } }))) {
        throw new OnboardingWorkspaceError(400, "That client no longer exists.");
      }
    }
    if (input.section === "laundry" && (patch as { laundrySupplierId?: string | null }).laundrySupplierId) {
      const supplierId = (patch as { laundrySupplierId: string }).laundrySupplierId;
      if (!(await tx.laundrySupplier.findUnique({ where: { id: supplierId }, select: { id: true } }))) {
        throw new OnboardingWorkspaceError(400, "That laundry partner no longer exists.");
      }
    }
    const state = editStateFromRow(row);
    let result = applySectionPatch(state, input.section, patch, { source: input.actor.source, actorUserId: input.actor.userId, now, encrypt: (plain) => encryptSecret(plain)! });
    if (typeof input.skipped === "boolean" && state.workspace.skipped.includes(input.section) !== input.skipped) {
      result = { ...result, next: setSkipped(result.next, input.section, input.skipped), changes: { ...result.changes, [`${input.section}.skipped`]: { before: !input.skipped, after: input.skipped } } };
    }

    const conflictRow =
      row.revision > input.baseRevision
        ? await tx.onboardingAnswerRevision.findFirst({
            where: {
              surveyId: row.id,
              revision: { gt: input.baseRevision },
              section: input.section,
              NOT: { AND: [{ source: input.actor.source }, { actorUserId: input.actor.userId }, { clientLinkId: input.actor.clientLinkId }] },
            },
            orderBy: { revision: "desc" },
          })
        : null;

    const fields = Object.keys(result.changes);
    if (fields.length === 0) {
      return { row, state: result.next, revision: row.revision, savedAt: row.lastSavedAt ?? row.updatedAt, conflictRow };
    }
    const revision = row.revision + 1;
    await writeState(tx, row, result, input.actor, now, revision);
    await tx.onboardingAnswerRevision.create({
      data: {
        surveyId: row.id,
        revision,
        section: input.section,
        fields,
        source: input.actor.source,
        actorUserId: input.actor.userId,
        clientLinkId: input.actor.clientLinkId,
        changes: result.changes as Prisma.InputJsonValue,
        createdAt: now,
      },
    });
    const fresh = await loadSurveyRow(tx, row.id);
    return { row: fresh!, state: result.next, revision, savedAt: now, conflictRow };
  });

  let conflict: SaveConflictView | null = null;
  if (outcome.conflictRow) {
    const names = await actorNames([outcome.conflictRow.actorUserId ?? ""]);
    conflict = {
      actorName: outcome.conflictRow.source === "CLIENT_SUBMITTED" ? "The client" : names.get(outcome.conflictRow.actorUserId ?? "") ?? "Someone in the office",
      source: outcome.conflictRow.source === "CLIENT_SUBMITTED" ? "CLIENT_SUBMITTED" : "ADMIN_CREATED",
      at: outcome.conflictRow.createdAt.toISOString(),
      section: outcome.conflictRow.section,
      changes: outcome.conflictRow.changes as SaveConflictView["changes"],
    };
  }
  const readiness = computeReadiness(readinessSnapshot(outcome.row, outcome.state));
  return {
    revision: outcome.revision,
    savedAt: outcome.savedAt.toISOString(),
    section: input.section,
    values: sectionValues(outcome.state)[input.section],
    readiness,
    skipped: outcome.state.workspace.skipped as OnboardingSectionKey[],
    conflict,
  };
}

/** The office accepts a code the client typed (it is then treated like one the office entered). */
export async function reviewClientCode(input: { surveyId: string; entryId: string; actorUserId: string; now?: Date }): Promise<{ revision: number }> {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PropertyOnboardingSurvey" WHERE "id" = ${input.surveyId} FOR UPDATE`;
    const row = await loadSurveyRow(tx, input.surveyId);
    if (!row) throw new OnboardingWorkspaceError(404, "This onboarding no longer exists.");
    if (!editableStatus(row.status)) throw new OnboardingWorkspaceError(409, "This onboarding can no longer be changed.");
    const state = editStateFromRow(row);
    const entry = state.workspace.access.find((candidate) => candidate.id === input.entryId);
    if (!entry || !entry.codeCipher) throw new OnboardingWorkspaceError(404, "That code is no longer there.");
    if (entry.codeReviewedAt) return { revision: row.revision };
    const access = state.workspace.access.map((candidate) =>
      candidate.id === input.entryId ? { ...candidate, codeReviewedAt: now.toISOString(), codeReviewedById: input.actorUserId } : candidate,
    );
    const revision = row.revision + 1;
    await tx.propertyOnboardingSurvey.update({
      where: { id: row.id },
      data: { workspace: { ...state.workspace, access } as unknown as Prisma.InputJsonValue, revision, lastSavedAt: now, lastSavedById: input.actorUserId, lastSavedSource: "ADMIN_CREATED" },
    });
    await tx.onboardingAnswerRevision.create({
      data: { surveyId: row.id, revision, section: "access", fields: [`access.codeReviewed.${entry.id}`], source: "ADMIN_CREATED", actorUserId: input.actorUserId, changes: { [`access.codeReviewed.${entry.id}`]: { before: false, after: true } }, createdAt: now },
    });
    return { revision };
  });
}

/** Plain code for the office's "Show" (audited). Never used by the client routes. */
export async function revealAccessCode(input: { surveyId: string; entryId: string; actorUserId: string }): Promise<string | null> {
  const row = await loadSurveyRow(db, input.surveyId);
  if (!row) throw new OnboardingWorkspaceError(404, "This onboarding no longer exists.");
  const entry = editStateFromRow(row).workspace.access.find((candidate) => candidate.id === input.entryId);
  if (!entry) throw new OnboardingWorkspaceError(404, "That access entry is no longer there.");
  await db.auditLog.create({
    data: { userId: input.actorUserId, action: "ONBOARDING_ACCESS_CODE_SHOWN", entity: "PropertyOnboardingSurvey", entityId: row.id, after: { entryId: entry.id, kind: entry.kind } },
  });
  return decryptSecret(entry.codeCipher);
}

const LAUNDRY_RULE_TITLES = [
  "Eligible cleans",
  "Pickup day",
  "Drop-off before the next clean",
  "Minimum turnaround",
  "Partner usual times",
  "Buffer linen flag",
  "Auto-approve re-planning after a calendar sync",
];

/** The live laundry scheduling rules, as sentences. Read only. */
export async function loadLaundryRules(): Promise<LaundryRulesView> {
  try {
    const book = await loadSchedulingRuleBook(db);
    const lines = RULES.filter((rule) => rule.domain === "laundry" && LAUNDRY_RULE_TITLES.includes(rule.title)).map((rule) => ruleSentence(rule, book.live.values));
    return { state: "ok", version: book.live.version, lines };
  } catch (error) {
    return { state: "unavailable", reason: error instanceof Error ? error.message : "The scheduling rules could not be read." };
  }
}

type LinkRow = Prisma.OnboardingClientLinkGetPayload<object>;

export function linkIsOpen(link: Pick<LinkRow, "revokedAt" | "expiresAt">, now: Date = new Date()): boolean {
  return !link.revokedAt && link.expiresAt.getTime() > now.getTime();
}

function askedSections(links: LinkRow[], now: Date): OnboardingSectionKey[] {
  const asked = new Set<OnboardingSectionKey>();
  for (const link of links) {
    if (!linkIsOpen(link, now) || link.finishedAt) continue;
    for (const section of link.sections) if (isClientLinkSection(section)) asked.add(CLIENT_SECTION_TO_STEP[section]);
  }
  return Array.from(asked);
}

function linkView(link: LinkRow, names: Map<string, string>, now: Date): ClientLinkView {
  return {
    id: link.id,
    sections: link.sections.filter(isClientLinkSection),
    transport: link.transport === "SMS" ? "SMS" : "EMAIL",
    recipientMasked: link.recipientMasked,
    createdAt: link.createdAt.toISOString(),
    createdByName: names.get(link.createdById) ?? null,
    expiresAt: link.expiresAt.toISOString(),
    revokedAt: link.revokedAt?.toISOString() ?? null,
    firstOpenedAt: link.firstOpenedAt?.toISOString() ?? null,
    lastOpenedAt: link.lastOpenedAt?.toISOString() ?? null,
    finishedAt: link.finishedAt?.toISOString() ?? null,
    deliveryState: link.deliveryState,
    deliveryError: link.deliveryError,
    open: linkIsOpen(link, now),
  };
}

function activationWarnings(adminNotes: string | null): string[] {
  return (adminNotes ?? "")
    .split("\n\n")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("⚠"))
    .map((part) => part.replace(/^⚠\s*/, ""));
}

export async function loadWorkspaceView(surveyId: string, viewerRole: string): Promise<OnboardingWorkspaceView | null> {
  const now = new Date();
  const row = await loadSurveyRow(db, surveyId);
  if (!row) return null;
  const [links, revisions, settings, laundryRules] = await Promise.all([
    db.onboardingClientLink.findMany({ where: { surveyId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.onboardingAnswerRevision.findMany({ where: { surveyId }, orderBy: { revision: "desc" }, take: 40 }),
    getAppSettings(),
    loadLaundryRules(),
  ]);
  const property = row.createdPropertyId ? await db.property.findUnique({ where: { id: row.createdPropertyId }, select: { id: true, name: true } }) : null;
  const names = await actorNames([
    row.lastSavedById ?? "",
    row.adminReviewerId ?? "",
    ...links.map((link) => link.createdById),
    ...revisions.map((revision) => revision.actorUserId ?? ""),
  ]);
  const state = editStateFromRow(row);
  const readiness: ReadinessSummary = computeReadiness(readinessSnapshot(row, state));
  const scenarios = (state.meta.scenarios ?? {}) as Record<string, unknown>;
  const history: AnswerRevisionView[] = revisions.map((revision) => ({
    revision: revision.revision,
    section: revision.section,
    fields: revision.fields,
    source: revision.source === "CLIENT_SUBMITTED" ? "CLIENT_SUBMITTED" : "ADMIN_CREATED",
    actorName: revision.source === "CLIENT_SUBMITTED" ? "Client (link)" : names.get(revision.actorUserId ?? "") ?? "Office",
    createdAt: revision.createdAt.toISOString(),
    changes: revision.changes as AnswerRevisionView["changes"],
  }));
  return {
    id: row.id,
    surveyNumber: row.surveyNumber,
    status: row.status as OnboardingStatus,
    sourceType: row.sourceType,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    startedByName: row.submittedBy ? row.submittedBy.name || row.submittedBy.email : null,
    lastSavedAt: (row.lastSavedAt ?? row.updatedAt).toISOString(),
    lastSavedByName: row.lastSavedSource === "CLIENT_SUBMITTED" ? "Client (link)" : names.get(row.lastSavedById ?? "") ?? null,
    lastSavedSource: row.lastSavedSource === "CLIENT_SUBMITTED" ? "CLIENT_SUBMITTED" : row.lastSavedSource ? "ADMIN_CREATED" : null,
    timezone: settings.timezone || "Australia/Sydney",
    values: sectionValues(state),
    clientName: clientLabel(row),
    clientContact: row.isNewClient
      ? { email: readClientData(row.clientData)?.email || null, phone: readClientData(row.clientData)?.phone || null }
      : { email: row.existingClient?.email ?? null, phone: row.existingClient?.phone ?? null },
    laundryPartnerName: row.laundrySupplier?.name ?? null,
    legacyAccess: row.accessDetails.map((detail) => ({ detailType: detail.detailType, hasValue: Boolean((detail.value ?? "").trim()), photoUrl: detail.photoUrl })),
    legacyAlarmCodeSaved: typeof scenarios.alarmCode === "string" && scenarios.alarmCode.trim().length > 0,
    checklistReviewed: checklistReviewed(row.adminOverrides),
    skipped: state.workspace.skipped as OnboardingSectionKey[],
    readiness,
    clientLinks: links.map((link) => linkView(link, names, now)),
    askedOfClient: askedSections(links, now),
    history,
    laundryRules,
    rejectionReason: row.rejectionReason,
    activation: property
      ? {
          propertyId: property.id,
          propertyName: property.name,
          activatedAt: row.reviewedAt?.toISOString() ?? null,
          activatedByName: names.get(row.adminReviewerId ?? "") ?? null,
          warnings: activationWarnings(row.adminNotes),
        }
      : null,
    canDeleteDrafts: viewerRole === "ADMIN",
  };
}

const BOARD_INCLUDE = {
  ...SURVEY_INCLUDE,
  clientLinks: { orderBy: { createdAt: "desc" as const }, take: 5 },
} satisfies Prisma.PropertyOnboardingSurveyInclude;

const ACTIVATED_WINDOW_DAYS = 30;

function boardTab(status: string, ready: boolean, waiting: boolean): OnboardingBoardRow["tab"] {
  if (status === "APPROVED") return "activated";
  if (status === "REJECTED") return "rejected";
  if (waiting) return "waiting";
  return ready ? "ready" : "progress";
}

function clientSectionsDone(sections: ClientLinkSection[], readiness: ReadinessSummary): number {
  return sections.filter((section) => {
    const step = CLIENT_SECTION_TO_STEP[section];
    const entries = readiness.items.filter((item) => item.section === step);
    return entries.length > 0 && entries.every((item) => item.state === "done");
  }).length;
}

/** The list: every open onboarding plus activations in the last 30 days and rejections, with readiness. */
export async function listOnboardingBoard(input: { tab: OnboardingBoardTab; search: string }): Promise<OnboardingBoardResponse> {
  const now = new Date();
  const since = new Date(now.getTime() - ACTIVATED_WINDOW_DAYS * 24 * 60 * 60_000);
  const search = input.search.trim();
  const rows = await db.propertyOnboardingSurvey.findMany({
    where: {
      AND: [
        { OR: [{ status: { in: ["DRAFT", "PENDING_REVIEW", "REJECTED"] } }, { status: "APPROVED", reviewedAt: { gte: since } }] },
        search
          ? {
              OR: [
                { surveyNumber: { contains: search, mode: "insensitive" } },
                { propertyName: { contains: search, mode: "insensitive" } },
                { propertyAddress: { contains: search, mode: "insensitive" } },
                { existingClient: { name: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {},
      ],
    },
    include: BOARD_INCLUDE,
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  const names = await actorNames(rows.map((row) => row.lastSavedById ?? ""));
  const all: OnboardingBoardRow[] = rows.map((row) => {
    const state = editStateFromRow(row);
    const readiness = computeReadiness(readinessSnapshot(row, state));
    const openLink = row.clientLinks.find((link) => linkIsOpen(link, now) && !link.finishedAt) ?? null;
    const latestLink = openLink ?? row.clientLinks[0] ?? null;
    const sections = latestLink ? latestLink.sections.filter(isClientLinkSection) : [];
    return {
      id: row.id,
      surveyNumber: row.surveyNumber,
      status: row.status as OnboardingStatus,
      tab: boardTab(row.status, readiness.ready, Boolean(openLink)),
      sourceType: row.sourceType,
      propertyName: row.propertyName,
      address: [row.propertyAddress, row.propertySuburb].filter(Boolean).join(", ") || null,
      clientName: clientLabel(row),
      isNewClient: row.isNewClient,
      readiness: {
        percent: readiness.percent,
        requiredDone: readiness.requiredDone,
        requiredTotal: readiness.requiredTotal,
        recommendedDone: readiness.recommendedDone,
        recommendedTotal: readiness.recommendedTotal,
        ready: readiness.ready,
        missingRequired: readiness.missingRequired.map((item) => item.label),
        next: readiness.next ? { section: readiness.next.section, label: readiness.next.label } : null,
        items: readiness.items.map((item) => ({ section: item.section, label: item.label, required: item.required, state: item.state, detail: item.detail })),
      },
      clientLink: latestLink
        ? {
            openedAt: latestLink.lastOpenedAt?.toISOString() ?? null,
            finishedAt: latestLink.finishedAt?.toISOString() ?? null,
            createdAt: latestLink.createdAt.toISOString(),
            sections,
            doneSections: clientSectionsDone(sections, readiness),
          }
        : null,
      askedOfClient: askedSections(row.clientLinks, now),
      lastSavedAt: (row.lastSavedAt ?? row.updatedAt).toISOString(),
      lastSavedByName: row.lastSavedSource === "CLIENT_SUBMITTED" ? "client" : names.get(row.lastSavedById ?? "") ?? (row.sourceType === "WEB_FORM" ? "website" : null),
      lastSavedSource: row.lastSavedSource === "CLIENT_SUBMITTED" ? "CLIENT_SUBMITTED" : row.lastSavedSource ? "ADMIN_CREATED" : null,
      startedByName: row.submittedBy ? row.submittedBy.name || row.submittedBy.email : null,
      createdPropertyId: row.createdPropertyId,
    };
  });
  const counts: Record<OnboardingBoardTab, number> = {
    open: all.filter((row) => row.tab !== "activated" && row.tab !== "rejected").length,
    progress: all.filter((row) => row.tab === "progress").length,
    waiting: all.filter((row) => row.tab === "waiting").length,
    ready: all.filter((row) => row.tab === "ready").length,
    activated: all.filter((row) => row.tab === "activated").length,
    rejected: all.filter((row) => row.tab === "rejected").length,
  };
  const filtered = input.tab === "open" ? all.filter((row) => row.tab !== "activated" && row.tab !== "rejected") : all.filter((row) => row.tab === input.tab);
  const settings = await getAppSettings();
  return { rows: filtered, counts, timezone: settings.timezone || "Australia/Sydney" };
}

/** Drafts with no answers at all (left by the old open-to-create behaviour). Listed for a deliberate, admin-only review. */
export async function listEmptyDrafts(): Promise<Array<{ id: string; surveyNumber: string; createdAt: string; startedByName: string | null }>> {
  const drafts = await db.propertyOnboardingSurvey.findMany({
    where: emptyDraftWhere(),
    include: { submittedBy: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return drafts.filter((draft) => !overridesHoldAnswers(draft.adminOverrides)).map((draft) => ({ id: draft.id, surveyNumber: draft.surveyNumber, createdAt: draft.createdAt.toISOString(), startedByName: draft.submittedBy ? draft.submittedBy.name || draft.submittedBy.email : null }));
}

/**
 * "No answers": nothing typed into any column, envelope or child table, never
 * saved through the workspace, never linked to a client or a client link.
 * Column defaults (1 bed, 1 bath, NSW) are not answers.
 */
export function emptyDraftWhere(): Prisma.PropertyOnboardingSurveyWhereInput {
  return {
    status: "DRAFT",
    revision: 0,
    workspace: { equals: Prisma.DbNull },
    existingClientId: null,
    clientData: { equals: Prisma.DbNull },
    propertyName: null,
    propertyAddress: null,
    propertySuburb: null,
    propertyPostcode: null,
    propertyNotes: null,
    propertyType: null,
    sizeSqm: null,
    icalUrl: null,
    laundrySupplierId: null,
    adminNotes: null,
    estimatedHours: null,
    estimatedPrice: null,
    bedrooms: 1,
    bathrooms: 1,
    hasBalcony: false,
    floorCount: 1,
    appliances: { none: {} },
    specialRequests: { none: {} },
    laundryDetail: { is: null },
    accessDetails: { none: {} },
    jobTypeAnswers: { none: {} },
    clientLinks: { none: {} },
  };
}

/** adminOverrides holding anything beyond the first-save key or an empty envelope counts as an answer. */
export function overridesHoldAnswers(adminOverrides: unknown): boolean {
  if (!adminOverrides || typeof adminOverrides !== "object" || Array.isArray(adminOverrides)) return false;
  const { draftCreateKey: _key, formMeta, ...rest } = adminOverrides as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return true;
  if (!formMeta || typeof formMeta !== "object") return false;
  return Object.values(formMeta as Record<string, unknown>).some((value) => {
    if (value === null || value === undefined || value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.values(value as Record<string, unknown>).some((inner) => inner !== null && inner !== undefined && inner !== "" && inner !== false);
    return true;
  });
}
