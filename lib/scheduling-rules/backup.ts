import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseIntegrationNotes } from "@/lib/ical/options";
import { getRecurringJobRules } from "@/lib/ops/recurring";
import { scheduleFromRow } from "@/lib/laundry/partner-schedule";
import { canonicalRuleValues, validateRuleValues, type SchedulingRuleValues } from "./values";
import { loadSchedulingRuleBook, SCHEDULING_RULES_SCHEMA_VERSION, systemAuditUserId } from "./store";
import type { RuleBook, RuleVersionRecord } from "./book";

/**
 * Scheduling-rule backups: the downloadable JSON file, the stored snapshots
 * (before every publish, weekly, on request) and reading a file back.
 *
 * A backup restores ONLY the rule values, always as a NEW version through the
 * same locked review/PIN/effective-date flow. The optional extras (per-property
 * calendar options, recurring rules, partner schedules) are a record for
 * reference; they are shown in the preview but never written back from a file.
 */
export const BACKUP_FORMAT = "sneek-scheduling-rules-backup";

export type BackupVersionEntry = {
  version: number;
  kind: string;
  effectiveFrom: string;
  appliesToExisting: boolean;
  reason: string;
  restoredFromVersion: number | null;
  createdAt: string;
  checksum: string;
  values: Record<string, number | boolean | string>;
};

export type BackupExtras = {
  icalOptions: Array<{ propertyId: string; propertyName: string; options: Record<string, boolean> }>;
  recurringRules: unknown[];
  partnerSchedules: Array<{ supplierId: string; name: string; schedule: unknown }>;
};

export type SchedulingRulesBackup = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  liveVersion: number;
  live: BackupVersionEntry;
  versions: BackupVersionEntry[];
  extras: BackupExtras | null;
  checksum: string;
};

/** Deterministic JSON (sorted keys) so a checksum never depends on key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function backupChecksum(document: Omit<SchedulingRulesBackup, "checksum">): string {
  return createHash("sha256").update(stableStringify(document)).digest("hex");
}

function entryOf(record: RuleVersionRecord): BackupVersionEntry {
  return {
    version: record.version,
    kind: record.kind,
    effectiveFrom: record.effectiveFrom,
    appliesToExisting: record.appliesToExisting,
    reason: record.reason,
    restoredFromVersion: record.restoredFromVersion,
    createdAt: record.createdAt.toISOString(),
    checksum: record.checksum,
    values: canonicalRuleValues(record.values),
  };
}

async function loadExtras(): Promise<BackupExtras> {
  const [integrations, recurringRules, suppliers] = await Promise.all([
    db.integration.findMany({ select: { propertyId: true, notes: true, property: { select: { name: true } } }, orderBy: { propertyId: "asc" } }),
    getRecurringJobRules(),
    db.laundrySupplier.findMany({
      select: { id: true, name: true, pickupWeekdays: true, pickupWindowStart: true, pickupWindowEnd: true, dropWeekdays: true, dropWindowStart: true, dropWindowEnd: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    icalOptions: integrations.map((row) => ({
      propertyId: row.propertyId,
      propertyName: row.property?.name ?? row.propertyId,
      options: { ...parseIntegrationNotes(row.notes).syncOptions },
    })),
    recurringRules,
    partnerSchedules: suppliers.map((row) => ({ supplierId: row.id, name: row.name, schedule: scheduleFromRow(row) })),
  };
}

/** The backup document of the current rules (fails closed like every reader). */
export async function buildSchedulingRulesBackup(options: { includeExtras: boolean; now?: Date; book?: RuleBook }): Promise<SchedulingRulesBackup> {
  const now = options.now ?? new Date();
  const book = options.book ?? (await loadSchedulingRuleBook(db, now));
  const body: Omit<SchedulingRulesBackup, "checksum"> = {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEDULING_RULES_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    liveVersion: book.live.version,
    live: entryOf(book.live),
    versions: book.versions.map(entryOf),
    extras: options.includeExtras ? await loadExtras() : null,
  };
  return { ...body, checksum: backupChecksum(body) };
}

/** Save a snapshot row (before every publish, weekly, or on request). */
export async function takeSchedulingRuleSnapshot(input: {
  source: "PRE_PUBLISH" | "WEEKLY" | "MANUAL";
  actorId?: string | null;
  client?: Prisma.TransactionClient | typeof db;
  /** Pass the book already read inside a locked transaction (avoids a second read). */
  book?: RuleBook;
}): Promise<{ id: string; liveVersion: number }> {
  const client = input.client ?? db;
  const document = await buildSchedulingRulesBackup({ includeExtras: input.source !== "PRE_PUBLISH", book: input.book });
  const row = await client.schedulingRuleSnapshot.create({
    data: {
      source: input.source,
      liveVersion: document.liveVersion,
      payload: document as unknown as Prisma.InputJsonObject,
      checksum: document.checksum,
      createdById: input.actorId ?? null,
    },
    select: { id: true },
  });
  const userId = input.actorId ?? (await systemAuditUserId(client));
  if (userId) {
    await client.auditLog.create({
      data: {
        userId,
        action: "SCHEDULING_RULES_SNAPSHOT",
        entity: "SchedulingRules",
        entityId: row.id,
        after: { source: input.source, liveVersion: document.liveVersion, checksum: document.checksum, ...(input.actorId ? {} : { systemActor: "SYSTEM_SCHEDULING_RULES" }) } as Prisma.InputJsonObject,
      },
    });
  }
  return { id: row.id, liveVersion: document.liveVersion };
}

const entrySchema = z.object({
  version: z.number().int().positive(),
  kind: z.string(),
  effectiveFrom: z.string(),
  appliesToExisting: z.boolean(),
  reason: z.string(),
  restoredFromVersion: z.number().int().nullable(),
  createdAt: z.string(),
  checksum: z.string(),
  values: z.record(z.union([z.number(), z.boolean(), z.string()])),
});

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  liveVersion: z.number().int().positive(),
  live: entrySchema,
  versions: z.array(entrySchema).max(10_000),
  extras: z.unknown().nullable(),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ParsedBackup = {
  values: SchedulingRuleValues;
  sourceVersion: number;
  exportedAt: string;
  versionCount: number;
  extras: unknown;
};

export type BackupReadResult = { ok: true; backup: ParsedBackup } | { ok: false; problems: string[] };

/** Validate a backup file: format, rules format, checksum and every value. Saves nothing. */
export function readSchedulingRulesBackup(text: string): BackupReadResult {
  if (text.length > 2_000_000) return { ok: false, problems: ["The file is too large to be a scheduling rules backup."] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["The file is not valid JSON."] };
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: ["This is not a scheduling rules backup file.", ...parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`)] };
  const document = parsed.data;
  if (document.schemaVersion !== SCHEDULING_RULES_SCHEMA_VERSION) {
    return { ok: false, problems: [`The backup uses rules format ${document.schemaVersion}; this app reads format ${SCHEDULING_RULES_SCHEMA_VERSION}.`] };
  }
  const { checksum, ...body } = raw as SchedulingRulesBackup;
  if (backupChecksum(body) !== checksum) return { ok: false, problems: ["The file's checksum does not match its contents: it was changed or damaged after it was downloaded."] };
  const values = validateRuleValues(document.live.values);
  if (!values.ok) return { ok: false, problems: values.problems };
  return { ok: true, backup: { values: values.values, sourceVersion: document.live.version, exportedAt: document.exportedAt, versionCount: document.versions.length, extras: document.extras } };
}

export async function listSchedulingRuleSnapshots(limit = 30) {
  return db.schedulingRuleSnapshot.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, source: true, liveVersion: true, checksum: true, createdAt: true, createdById: true },
  });
}

/** The backup document stored in a snapshot, re-validated before use. */
export async function readSnapshotBackup(id: string): Promise<BackupReadResult> {
  const row = await db.schedulingRuleSnapshot.findUnique({ where: { id }, select: { payload: true } });
  if (!row) return { ok: false, problems: ["That snapshot no longer exists."] };
  return readSchedulingRulesBackup(JSON.stringify(row.payload));
}
