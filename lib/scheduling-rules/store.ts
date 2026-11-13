import "server-only";
import { createHash } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getTransactionAppSettings, writeSchedulingRuleSettings, type AppSettings } from "@/lib/settings";
import { SYSTEM_SCHEDULING_RULES_ACTOR, systemActorMarker } from "@/lib/audit/system-actor";
import { buildRuleBook, ORIGINAL_EFFECTIVE_FROM, type RuleBook, type RuleVersionKind, type RuleVersionRecord } from "./book";
import {
  canonicalRuleValues,
  EDITABLE_RULE_SPECS,
  ORIGINAL_CODE_VALUES,
  readSettingPath,
  SETTING_RULE_KEYS,
  SETTINGS_FIELD_DEFAULTS,
  validateRuleValues,
  type EditableRuleKey,
  type SchedulingRuleValues,
} from "./values";

/**
 * The versioned scheduling-rule store (table SchedulingRuleVersion).
 *
 * FAIL CLOSED. Every reader goes through `loadSchedulingRuleBook`, which either
 * returns a fully validated book or throws `SchedulingRulesUnavailableError`
 * with a plain reason. It never falls back to code defaults: a corrupt row, a
 * failed checksum, an unreadable table or a failed activation stops the caller
 * (the worker records the reason; the iCal run is marked ERROR; the screen
 * shows "unavailable").
 *
 * Version 1 is created the first time the rules are read, inside the same
 * advisory lock as every other write, from the LIVE stored settings (for rules
 * that were settings) and the original literals (for rules that were in code).
 */
export const SCHEDULING_RULES_SCHEMA_VERSION = 1;
export const SCHEDULING_RULES_LOCK = "scheduling-rules";

export class SchedulingRulesUnavailableError extends Error {
  readonly code = "SCHEDULING_RULES_UNAVAILABLE";
  constructor(readonly reason: string) {
    super(`Scheduling rules are unavailable: ${reason}`);
    this.name = "SchedulingRulesUnavailableError";
  }
}

type Client = Prisma.TransactionClient | typeof db;

export function checksumOf(values: SchedulingRuleValues): string {
  return createHash("sha256").update(JSON.stringify(canonicalRuleValues(values))).digest("hex");
}

/** Version-1 values: live settings for setting rules, the original literals for code rules. */
export function originalValuesFromSettings(settings: AppSettings): { values: SchedulingRuleValues; missing: string[] } {
  const missing: string[] = [];
  const values = { ...ORIGINAL_CODE_VALUES } as Record<string, unknown>;
  for (const key of SETTING_RULE_KEYS) {
    const spec = EDITABLE_RULE_SPECS[key];
    if (spec.storage.kind !== "setting") continue;
    const value = readSettingPath(settings, spec.storage.path);
    // Absent from the settings object: the engine runs on the sanitizer's
    // default for it, so that IS the live value. Recorded on the seed audit.
    if (value === undefined) missing.push(key);
    values[key] = value === undefined ? SETTINGS_FIELD_DEFAULTS[key] : value;
  }
  return { values: values as SchedulingRuleValues, missing };
}

type StoredRow = {
  version: number;
  kind: string;
  values: Prisma.JsonValue;
  effectiveFrom: string;
  appliesToExisting: boolean;
  reason: string;
  restoredFromVersion: number | null;
  createdById: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  checksum: string;
  schemaVersion: number;
};

const KINDS: RuleVersionKind[] = ["ORIGINAL", "EDIT", "RESTORE", "IMPORT"];

export function decodeVersionRow(row: StoredRow): RuleVersionRecord {
  if (row.schemaVersion !== SCHEDULING_RULES_SCHEMA_VERSION) {
    throw new SchedulingRulesUnavailableError(`version ${row.version} was saved by a different rules format (${row.schemaVersion}).`);
  }
  if (!KINDS.includes(row.kind as RuleVersionKind)) throw new SchedulingRulesUnavailableError(`version ${row.version} has an unknown kind.`);
  const validated = validateRuleValues(row.values);
  if (!validated.ok) throw new SchedulingRulesUnavailableError(`version ${row.version} failed validation (${validated.problems[0]}).`);
  if (checksumOf(validated.values) !== row.checksum) throw new SchedulingRulesUnavailableError(`version ${row.version} failed its checksum.`);
  return {
    version: row.version,
    kind: row.kind as RuleVersionKind,
    values: validated.values,
    effectiveFrom: row.effectiveFrom,
    appliesToExisting: row.appliesToExisting,
    reason: row.reason,
    restoredFromVersion: row.restoredFromVersion,
    createdById: row.createdById,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
    checksum: row.checksum,
    schemaVersion: row.schemaVersion,
  };
}

/** A transaction client has no $transaction method (read through `get`, so proxies work too). */
function isTransactionClient(client: Client): client is Prisma.TransactionClient {
  return typeof (client as { $transaction?: unknown }).$transaction !== "function";
}

/** Run `work` in a transaction holding the scheduling-rules advisory lock. */
export async function withRulesLock<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, client: Client = db): Promise<T> {
  const run = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SCHEDULING_RULES_LOCK}))`;
    return work(tx);
  };
  return isTransactionClient(client) ? run(client) : (client as typeof db).$transaction(run);
}

async function readRows(client: Client): Promise<StoredRow[]> {
  return client.schedulingRuleVersion.findMany({ orderBy: { version: "asc" } });
}

/** The earliest active administrator: the account system rows are recorded under (marked as system). */
export async function systemAuditUserId(client: Client): Promise<string | null> {
  const admin = await client.user.findFirst({ where: { role: Role.ADMIN, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return admin?.id ?? null;
}

async function seedOriginal(tx: Prisma.TransactionClient): Promise<void> {
  const existing = await tx.schedulingRuleVersion.count();
  if (existing > 0) return;
  // Strict read: a database error stops the seed; it never seeds code defaults.
  const settings = await getTransactionAppSettings(tx);
  const { values, missing } = originalValuesFromSettings(settings);
  const validated = validateRuleValues(values);
  if (!validated.ok) {
    throw new SchedulingRulesUnavailableError(`the live settings could not be read as rules (${validated.problems[0]}).`);
  }
  const checksum = checksumOf(validated.values);
  await tx.schedulingRuleVersion.create({
    data: {
      version: 1,
      kind: "ORIGINAL",
      values: canonicalRuleValues(validated.values) as Prisma.InputJsonObject,
      schemaVersion: SCHEDULING_RULES_SCHEMA_VERSION,
      checksum,
      effectiveFrom: ORIGINAL_EFFECTIVE_FROM,
      appliesToExisting: false,
      reason: "Original (current behaviour): the rules exactly as they were, seeded from the live settings and the original code values.",
      activatedAt: new Date(),
    },
  });
  const userId = await systemAuditUserId(tx);
  if (userId) {
    await tx.auditLog.create({
      data: {
        userId,
        action: "SCHEDULING_RULES_SEEDED",
        entity: "SchedulingRules",
        entityId: "1",
        after: { version: 1, checksum, values: canonicalRuleValues(validated.values), filledFromSettingsDefaults: missing, ...systemActorMarker(SYSTEM_SCHEDULING_RULES_ACTOR) } as Prisma.InputJsonObject,
      },
    });
  }
  logger.info({ checksum }, "Scheduling rules version 1 seeded from live settings");
}

/**
 * Mirror the live version's setting-backed values into AppSettings when it has
 * not been mirrored yet (a version just became effective). Idempotent.
 */
async function activateIfDue(tx: Prisma.TransactionClient, now: Date): Promise<boolean> {
  const book = buildRuleBook((await readRows(tx)).map(decodeVersionRow), now);
  const pending = book.versions.filter((record) => record.activatedAt === null && record.version <= book.live.version);
  if (pending.length === 0) return false;
  const entries = SETTING_RULE_KEYS.map((key) => {
    const spec = EDITABLE_RULE_SPECS[key];
    return { path: (spec.storage as { kind: "setting"; path: readonly [string, string] }).path, value: book.live.values[key] };
  });
  await writeSchedulingRuleSettings(tx, entries);
  await tx.schedulingRuleVersion.updateMany({ where: { version: { in: pending.map((record) => record.version) }, activatedAt: null }, data: { activatedAt: now } });
  const userId = await systemAuditUserId(tx);
  if (userId) {
    await tx.auditLog.create({
      data: {
        userId,
        action: "SCHEDULING_RULES_ACTIVATED",
        entity: "SchedulingRules",
        entityId: String(book.live.version),
        after: { liveVersion: book.live.version, effectiveFrom: book.live.effectiveFrom, ...systemActorMarker(SYSTEM_SCHEDULING_RULES_ACTOR) } as Prisma.InputJsonObject,
      },
    });
  }
  logger.info({ liveVersion: book.live.version }, "Scheduling rules version went live");
  return true;
}

function unavailable(error: unknown): SchedulingRulesUnavailableError {
  if (error instanceof SchedulingRulesUnavailableError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SchedulingRulesUnavailableError(`the rules could not be read (${message.slice(0, 200)}).`);
}

/**
 * The validated rule book. Seeds version 1 on first read and mirrors a version
 * that has just become live. Throws SchedulingRulesUnavailableError otherwise.
 * `client` may be a transaction (the reads and any seed join it).
 */
export async function loadSchedulingRuleBook(client: Client = db, now: Date = new Date()): Promise<RuleBook> {
  try {
    let rows = await readRows(client);
    if (rows.length === 0) {
      await withRulesLock((tx) => seedOriginal(tx), client);
      rows = await readRows(client);
    }
    const book = buildRuleBook(rows.map(decodeVersionRow), now);
    if (book.versions.some((record) => record.activatedAt === null && record.version <= book.live.version)) {
      await withRulesLock((tx) => activateIfDue(tx, now), client);
    }
    return book;
  } catch (error) {
    const failure = unavailable(error);
    logger.error({ reason: failure.reason }, "Scheduling rules unavailable");
    throw failure;
  }
}

/** For the hourly worker: make a version that became effective live in AppSettings. */
export async function activateDueSchedulingRules(now: Date = new Date()): Promise<{ liveVersion: number }> {
  const book = await loadSchedulingRuleBook(db, now);
  return { liveVersion: book.live.version };
}

/**
 * Whether the stored settings still match the live version for every
 * setting-backed rule (false = someone changed the settings row outside the
 * rule service; the screen shows it as stale and the next activation repairs it).
 */
export function settingsMatchLive(settings: AppSettings, live: RuleVersionRecord): EditableRuleKey[] {
  const drift: EditableRuleKey[] = [];
  for (const key of SETTING_RULE_KEYS) {
    const spec = EDITABLE_RULE_SPECS[key];
    if (spec.storage.kind !== "setting") continue;
    if (readSettingPath(settings, spec.storage.path) !== live.values[key]) drift.push(key);
  }
  return drift;
}
