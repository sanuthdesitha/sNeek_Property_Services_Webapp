/**
 * Tutorial storage (server). Per-person rows replace the single `tutorialSeen`
 * flag in the shared AuthUserState settings row, so recording one step never
 * rewrites anyone else's state. Every function takes the Prisma client so the
 * database tests can run it against a disposable database.
 *
 * Callers decide WHO: routes pass the genuinely signed-in person and refuse to
 * record while testing as someone else (see app/api/me/tours).
 */
import type { Prisma, PrismaClient, TourProgress } from "@prisma/client";
import { findTour, TOURS } from "./registry";
import { effectiveVersion } from "./engine";
import type {
  TourClientState,
  TourOverrides,
  TourProgressRecord,
  TourPublishStatus,
  TourRole,
  TourSettingView,
  TourStepOverride,
} from "./types";
import { TOUR_ROLES } from "./types";
import type { PreferenceInput, ProgressInput, TourSettingInput } from "./validation";

export type TourDb = Pick<PrismaClient, "tourProgress" | "userTourPreference" | "tourSetting" | "$transaction">;

export class TourInputError extends Error {}

function toRecord(row: TourProgress): TourProgressRecord {
  return {
    tourKey: row.tourKey,
    version: row.version,
    status: row.status,
    seenSteps: row.seenSteps,
    missingSteps: row.missingSteps,
    currentStep: row.currentStep,
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

function parseOverrides(value: Prisma.JsonValue | null): TourOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as { steps?: unknown; order?: unknown };
  const steps = Array.isArray(raw.steps)
    ? raw.steps.filter((entry): entry is TourStepOverride => Boolean(entry) && typeof (entry as TourStepOverride).id === "string")
    : undefined;
  const order = Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === "string") : undefined;
  return { steps, order };
}

function parseStatus(value: string | null): TourPublishStatus {
  return value === "DRAFT" || value === "PAUSED" ? value : "LIVE";
}

export type TourSettingsSnapshot = {
  roles: Record<TourRole, boolean>;
  tours: Record<string, TourSettingView>;
};

/** Role switches default to on; a tour without a row is live with code wording. */
export async function readTourSettings(db: TourDb): Promise<TourSettingsSnapshot> {
  const rows = await db.tourSetting.findMany();
  const roles = Object.fromEntries(TOUR_ROLES.map((role) => [role, true])) as Record<TourRole, boolean>;
  const tours: Record<string, TourSettingView> = {};
  for (const row of rows) {
    if (row.scope === "ROLE" && (TOUR_ROLES as readonly string[]).includes(row.key)) {
      roles[row.key as TourRole] = row.toursOn !== false;
    } else if (row.scope === "TOUR" && findTour(row.key)) {
      tours[row.key] = {
        status: parseStatus(row.status),
        revision: row.revision,
        overrides: parseOverrides(row.overrides),
        updatedAt: row.updatedAt.toISOString(),
      };
    }
  }
  return { roles, tours };
}

export type TourViewerIdentity = {
  userId: string;
  role: TourRole;
  /** Testing as / impersonating: nothing is read or recorded for anyone. */
  impersonating: boolean;
  legacyWelcomeSeen: boolean;
};

export async function readTourClientState(db: TourDb, viewer: TourViewerIdentity): Promise<TourClientState> {
  const settings = await readTourSettings(db);
  const base = {
    role: viewer.role,
    roleToursOn: settings.roles[viewer.role] !== false,
    settings: settings.tours,
    legacyWelcomeSeen: viewer.legacyWelcomeSeen,
  };
  if (viewer.impersonating) {
    return {
      ...base,
      recordable: false,
      notRecordableReason: "Testing as someone else: tours can be replayed from Help, but nothing is recorded.",
      toursOn: true,
      dontShowAgain: [],
      progress: {},
    };
  }
  const [rows, preference] = await Promise.all([
    db.tourProgress.findMany({ where: { userId: viewer.userId } }),
    db.userTourPreference.findUnique({ where: { userId: viewer.userId } }),
  ]);
  return {
    ...base,
    recordable: true,
    notRecordableReason: null,
    toursOn: preference?.toursOn !== false,
    dontShowAgain: preference?.dontShowAgain ?? [],
    progress: Object.fromEntries(rows.filter((row) => findTour(row.tourKey)).map((row) => [row.tourKey, toRecord(row)])),
  };
}

/**
 * Record one person's progress on one tour. A finished tour is never
 * downgraded by a later replay that was skipped part-way; seen steps merge
 * within the same version and reset when the version moves on.
 */
export async function recordTourProgress(db: TourDb, userId: string, input: ProgressInput): Promise<TourProgressRecord> {
  const tour = findTour(input.tourKey);
  if (!tour) throw new TourInputError("Unknown tour.");
  const settings = await readTourSettings(db);
  const current = effectiveVersion(tour, settings.tours[tour.key]);
  const version = Math.min(input.version, current);
  const known = new Set(tour.steps.map((step) => step.id));
  const seen = input.seenSteps.filter((id) => known.has(id));
  const missing = input.missingSteps.filter((id) => known.has(id));

  return db.$transaction(async (tx) => {
    const existing = await tx.tourProgress.findUnique({ where: { userId_tourKey: { userId, tourKey: tour.key } } });
    const now = new Date();
    if (existing && existing.status === "DONE" && existing.version >= version && input.status !== "DONE") {
      const merged = await tx.tourProgress.update({
        where: { id: existing.id },
        data: { seenSteps: union(existing.seenSteps, seen), missingSteps: union(existing.missingSteps, missing) },
      });
      return toRecord(merged);
    }
    const sameVersion = existing && existing.version === version;
    const data = {
      version,
      status: input.status,
      seenSteps: sameVersion ? union(existing.seenSteps, seen) : seen,
      missingSteps: sameVersion ? union(existing.missingSteps, missing) : missing,
      currentStep: input.currentStep,
      startedAt: existing?.startedAt ?? (input.status === "NOT_STARTED" ? null : now),
      completedAt: input.status === "DONE" ? now : existing?.completedAt ?? null,
    };
    const row = existing
      ? await tx.tourProgress.update({ where: { id: existing.id }, data })
      : await tx.tourProgress.create({ data: { ...data, userId, tourKey: tour.key } });
    return toRecord(row);
  });
}

function union(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b])).slice(0, 60);
}

export async function updateTourPreference(
  db: TourDb,
  userId: string,
  patch: PreferenceInput,
  actorId: string,
): Promise<{ toursOn: boolean; dontShowAgain: string[] }> {
  if (patch.dontShowAgain && !findTour(patch.dontShowAgain.tourKey)) throw new TourInputError("Unknown tour.");
  return db.$transaction(async (tx) => {
    const existing = await tx.userTourPreference.findUnique({ where: { userId } });
    let dontShowAgain = existing?.dontShowAgain ?? [];
    if (patch.dontShowAgain) {
      const { tourKey, value } = patch.dontShowAgain;
      dontShowAgain = value ? union(dontShowAgain, [tourKey]) : dontShowAgain.filter((key) => key !== tourKey);
    }
    const toursOn = patch.toursOn ?? existing?.toursOn ?? true;
    const row = await tx.userTourPreference.upsert({
      where: { userId },
      create: { userId, toursOn, dontShowAgain, updatedById: actorId },
      update: { toursOn, dontShowAgain, updatedById: actorId },
    });
    return { toursOn: row.toursOn, dontShowAgain: row.dontShowAgain };
  });
}

/* ── Administrator screen ───────────────────────────────────────────────── */

export async function setRoleToursOn(db: TourDb, role: TourRole, toursOn: boolean, actorId: string): Promise<void> {
  await db.tourSetting.upsert({
    where: { scope_key: { scope: "ROLE", key: role } },
    create: { scope: "ROLE", key: role, toursOn, updatedById: actorId },
    update: { toursOn, updatedById: actorId },
  });
}

/**
 * Publish an administrator's change to one tour. Wording edits re-show nothing;
 * a step ticked "Show as What's new" raises the revision, so people who
 * finished see only that step on their next visit.
 */
export async function saveTourSetting(
  db: TourDb,
  tourKey: string,
  input: TourSettingInput,
  actorId: string,
): Promise<TourSettingView> {
  const tour = findTour(tourKey);
  if (!tour) throw new TourInputError("Unknown tour.");
  const known = new Set(tour.steps.map((step) => step.id));
  if (input.steps?.some((entry) => !known.has(entry.id)) || input.order?.some((id) => !known.has(id))) {
    throw new TourInputError("A step does not belong to this tour.");
  }
  return db.$transaction(async (tx) => {
    const existing = await tx.tourSetting.findUnique({ where: { scope_key: { scope: "TOUR", key: tourKey } } });
    const previous = parseOverrides(existing?.overrides ?? null);
    const marksWhatsNew = Boolean(input.steps?.some((entry) => entry.whatsNew));
    const revision = (existing?.revision ?? 0) + (marksWhatsNew ? 1 : 0);
    const previousById = new Map((previous.steps ?? []).map((entry) => [entry.id, entry]));
    const steps: TourStepOverride[] | undefined = input.steps
      ? input.steps.map((entry) => ({
          id: entry.id,
          title: entry.title || undefined,
          body: entry.body || undefined,
          hidden: entry.hidden || undefined,
          target: (entry.target as TourStepOverride["target"]) || undefined,
          whatsNewRevision: entry.whatsNew ? revision : previousById.get(entry.id)?.whatsNewRevision,
        }))
      : previous.steps;
    const overrides: TourOverrides = { steps, order: input.order ?? previous.order };
    const status = input.status ?? parseStatus(existing?.status ?? null);
    const row = await tx.tourSetting.upsert({
      where: { scope_key: { scope: "TOUR", key: tourKey } },
      create: { scope: "TOUR", key: tourKey, status, revision, overrides: overrides as Prisma.InputJsonValue, updatedById: actorId },
      update: { status, revision, overrides: overrides as Prisma.InputJsonValue, updatedById: actorId },
    });
    return { status: parseStatus(row.status), revision: row.revision, overrides, updatedAt: row.updatedAt.toISOString() };
  });
}

export type TourStats = {
  tourKey: string;
  /** People with any record for this tour. */
  opened: number;
  finished: number;
  skipped: number;
  /** People whose run passed a step because its control was missing. */
  missingReports: number;
};

/** Finished = reached the last step of the current version; skipped includes Don't show again. */
export async function readTourStats(db: TourDb): Promise<TourStats[]> {
  const settings = await readTourSettings(db);
  const rows = await db.tourProgress.findMany({ select: { tourKey: true, version: true, status: true, missingSteps: true } });
  return TOURS.map((tour) => {
    const current = effectiveVersion(tour, settings.tours[tour.key]);
    const mine = rows.filter((row) => row.tourKey === tour.key);
    return {
      tourKey: tour.key,
      opened: mine.length,
      finished: mine.filter((row) => row.status === "DONE" && row.version >= current).length,
      skipped: mine.filter((row) => row.status === "SKIPPED" || row.status === "DISMISSED").length,
      missingReports: mine.filter((row) => row.missingSteps.length > 0).length,
    };
  });
}

export async function readPersonTours(db: TourDb, userId: string) {
  const [rows, preference] = await Promise.all([
    db.tourProgress.findMany({ where: { userId } }),
    db.userTourPreference.findUnique({ where: { userId } }),
  ]);
  return {
    toursOn: preference?.toursOn !== false,
    progress: rows.filter((row) => findTour(row.tourKey)).map(toRecord),
  };
}

/** Reset makes a tour show again on the person's next visit. Their work is not touched. */
export async function resetPersonTours(db: TourDb, userId: string, tourKey: "all" | string): Promise<number> {
  if (tourKey !== "all" && !findTour(tourKey)) throw new TourInputError("Unknown tour.");
  return db.$transaction(async (tx) => {
    const where = tourKey === "all" ? { userId } : { userId, tourKey };
    const removed = await tx.tourProgress.deleteMany({ where });
    const preference = await tx.userTourPreference.findUnique({ where: { userId } });
    if (preference) {
      const dontShowAgain = tourKey === "all" ? [] : preference.dontShowAgain.filter((key) => key !== tourKey);
      await tx.userTourPreference.update({ where: { userId }, data: { dontShowAgain } });
    }
    return removed.count;
  });
}
