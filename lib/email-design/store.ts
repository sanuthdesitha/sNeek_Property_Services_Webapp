import "server-only";
/**
 * Versioned store for email designs and the "Email look" theme. It follows
 * the wording layer's store (lib/notifications/wording/store.ts): one
 * AppSetting row per email (`emailDesign:<key>`) and one for the theme
 * (`emailLook`), no schema change, an advisory lock per row, a stale-write
 * guard (the row's revision, 409), the last 60 versions kept, and an audit row
 * naming the actual person and role. It differs where blocks need it: a
 * document is not a string, and there is a draft beside the published version.
 *
 * Version 1 is always the standard (the current wording carried over, in
 * code; never stored). A draft never reaches anyone: only `publish` makes a
 * version live, and the route checks the administrator's own PIN first.
 * Restore and Reset only create drafts.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { DesignActor, DesignRow, DesignVersion, ThemeRow, ThemeVersion } from "./store-types";
import { blockingChecks, checkDocument, documentKey, parseDocument } from "./checks";
import { emailDesign } from "./registry";
import { DEFAULT_EMAIL_THEME, sanitizeTheme, themeProblems } from "./theme";
import type { EmailDesignDefinition, EmailDocument, EmailTheme } from "./types";

export const EMAIL_DESIGN_PREFIX = "emailDesign:";
export const EMAIL_LOOK_KEY = "emailLook";
const HISTORY_LIMIT = 60;

export type { DesignActor, DesignDraft, DesignRow, DesignVersion, ThemeDraft, ThemeRow, ThemeVersion } from "./store-types";

export class EmailDesignError extends Error {
  constructor(readonly status: number, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

function designRowKey(key: string): string {
  return `${EMAIL_DESIGN_PREFIX}${key}`;
}

function parseActor(value: unknown): DesignActor {
  const row = (value ?? {}) as Partial<DesignActor>;
  return { id: String(row.id ?? ""), name: typeof row.name === "string" ? row.name : null, role: String(row.role ?? "") };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value.slice(0, 200) : null;
}

export function parseDesignRow(value: unknown): DesignRow {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const versions = Array.isArray(row.versions)
    ? row.versions.flatMap((item): DesignVersion[] => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      const doc = parseDocument(entry.doc);
      if (typeof entry.version !== "number" || !doc || typeof entry.savedAt !== "string") return [];
      return [{ version: entry.version, doc, savedAt: entry.savedAt, actor: parseActor(entry.actor), change: typeof entry.change === "string" ? entry.change : "", restoredFrom: typeof entry.restoredFrom === "number" ? entry.restoredFrom : null, idempotencyKey: stringOrNull(entry.idempotencyKey) }];
    })
    : [];
  const draftRaw = row.draft && typeof row.draft === "object" ? (row.draft as Record<string, unknown>) : null;
  const draftDoc = draftRaw ? parseDocument(draftRaw.doc) : null;
  const draft = draftRaw && draftDoc && typeof draftRaw.savedAt === "string"
    ? { doc: draftDoc, savedAt: draftRaw.savedAt, actor: parseActor(draftRaw.actor), basedOn: typeof draftRaw.basedOn === "number" ? draftRaw.basedOn : 1, idempotencyKey: stringOrNull(draftRaw.idempotencyKey) }
    : null;
  const published = typeof row.publishedVersion === "number" && versions.some((item) => item.version === row.publishedVersion) ? row.publishedVersion : null;
  return { revision: typeof row.revision === "number" ? row.revision : 0, publishedVersion: published, draft, versions };
}

export function parseThemeRow(value: unknown): ThemeRow {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const versions = Array.isArray(row.versions)
    ? row.versions.flatMap((item): ThemeVersion[] => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      if (typeof entry.version !== "number" || typeof entry.savedAt !== "string") return [];
      return [{ version: entry.version, theme: sanitizeTheme(entry.theme), savedAt: entry.savedAt, actor: parseActor(entry.actor), idempotencyKey: stringOrNull(entry.idempotencyKey) }];
    })
    : [];
  const draftRaw = row.draft && typeof row.draft === "object" ? (row.draft as Record<string, unknown>) : null;
  const draft = draftRaw && typeof draftRaw.savedAt === "string" ? { theme: sanitizeTheme(draftRaw.theme), savedAt: draftRaw.savedAt, actor: parseActor(draftRaw.actor) } : null;
  const published = typeof row.publishedVersion === "number" && versions.some((item) => item.version === row.publishedVersion) ? row.publishedVersion : null;
  return { revision: typeof row.revision === "number" ? row.revision : 0, publishedVersion: published, draft, versions };
}

export async function readDesignRow(key: string): Promise<DesignRow> {
  const row = await db.appSetting.findUnique({ where: { key: designRowKey(key) }, select: { value: true } });
  return parseDesignRow(row?.value);
}

export async function readThemeRow(): Promise<ThemeRow> {
  const row = await db.appSetting.findUnique({ where: { key: EMAIL_LOOK_KEY }, select: { value: true } });
  return parseThemeRow(row?.value);
}

/** The live theme. A read failure sends with the standard theme (and is logged): email must not stop. */
export async function getPublishedEmailTheme(): Promise<EmailTheme> {
  try {
    const row = await readThemeRow();
    return row.versions.find((item) => item.version === row.publishedVersion)?.theme ?? DEFAULT_EMAIL_THEME;
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Email look unavailable; the standard look was used");
    return DEFAULT_EMAIL_THEME;
  }
}

/**
 * The live document of an email, or null for the standard (version 1). A
 * stored version that no longer passes the checks (e.g. a value was renamed)
 * is ignored and logged: the standard goes out instead.
 */
export async function getPublishedDocument(definition: EmailDesignDefinition): Promise<EmailDocument | null> {
  try {
    const row = await readDesignRow(definition.key);
    const live = row.versions.find((item) => item.version === row.publishedVersion);
    if (!live) return null;
    if (blockingChecks(checkDocument(definition, live.doc)).length) {
      logger.warn({ key: definition.key, version: live.version }, "Published email design no longer valid; the standard was used");
      return null;
    }
    return live.doc;
  } catch (error) {
    logger.warn({ key: definition.key, error: error instanceof Error ? error.message : String(error) }, "Email design unavailable; the standard was used");
    return null;
  }
}

type Tx = Prisma.TransactionClient;

async function lockAndRead(tx: Tx, key: string): Promise<unknown> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  const stored = await tx.appSetting.findUnique({ where: { key }, select: { value: true } });
  return stored?.value;
}

async function write(tx: Tx, key: string, value: unknown): Promise<void> {
  const json = value as Prisma.InputJsonValue;
  await tx.appSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}

function requireDefinition(key: string): EmailDesignDefinition {
  const definition = emailDesign(key);
  if (!definition) throw new EmailDesignError(404, "No email design with that name.");
  return definition;
}

function guardRevision(row: { revision: number }, expected: number): void {
  if (row.revision !== expected) throw new EmailDesignError(409, "This email changed since you opened it. Reload to see the current version; your draft is kept on this screen.");
}

function refuseSecurity(definition: EmailDesignDefinition): void {
  if (definition.security) throw new EmailDesignError(409, "Security emails keep their words fixed. Only the Email look applies to them.");
}

export function versionDocument(definition: EmailDesignDefinition, row: DesignRow, version: number): EmailDocument | null {
  if (version === 1) return definition.defaults;
  return row.versions.find((item) => item.version === version)?.doc ?? null;
}

export type DraftInput = { key: string; doc: unknown; expectedRevision: number; idempotencyKey: string | null; actor: DesignActor };

/** Saves the draft (never live). A retry with the same idempotency key does not change anything. */
export async function saveDesignDraft(input: DraftInput): Promise<DesignRow> {
  const definition = requireDefinition(input.key);
  refuseSecurity(definition);
  const doc = parseDocument(input.doc);
  if (!doc) throw new EmailDesignError(400, "The email could not be read. Nothing was saved.");
  const key = designRowKey(input.key);
  return db.$transaction(async (tx) => {
    const row = parseDesignRow(await lockAndRead(tx, key));
    if (input.idempotencyKey && row.draft?.idempotencyKey === input.idempotencyKey && documentKey(row.draft.doc) === documentKey(doc)) return row;
    guardRevision(row, input.expectedRevision);
    const next: DesignRow = { ...row, revision: row.revision + 1, draft: { doc, savedAt: new Date().toISOString(), actor: input.actor, basedOn: row.draft?.basedOn ?? row.publishedVersion ?? 1, idempotencyKey: input.idempotencyKey } };
    await write(tx, key, next);
    return next;
  });
}

type RowChange = { key: string; expectedRevision: number; actor: DesignActor };

async function auditDesign(tx: Tx, actor: DesignActor, action: string, key: string, after: Record<string, unknown>, before: Record<string, unknown> = {}): Promise<void> {
  await tx.auditLog.create({ data: { userId: actor.id, action, entity: "AppSetting", entityId: designRowKey(key), before: before as Prisma.InputJsonValue, after: { ...after, actorRole: actor.role } as Prisma.InputJsonValue } });
}

/** A copy of an earlier version becomes the draft. Nothing goes live. */
export async function restoreDesignVersion(input: RowChange & { version: number }, auditAction = "EMAIL_DESIGN_RESTORED_AS_DRAFT"): Promise<DesignRow> {
  const definition = requireDefinition(input.key);
  refuseSecurity(definition);
  const key = designRowKey(input.key);
  return db.$transaction(async (tx) => {
    const row = parseDesignRow(await lockAndRead(tx, key));
    guardRevision(row, input.expectedRevision);
    const doc = versionDocument(definition, row, input.version);
    if (!doc) throw new EmailDesignError(404, "That version no longer exists.");
    const next: DesignRow = { ...row, revision: row.revision + 1, draft: { doc, savedAt: new Date().toISOString(), actor: input.actor, basedOn: input.version, idempotencyKey: null } };
    await write(tx, key, next);
    await auditDesign(tx, input.actor, auditAction, input.key, { key: input.key, restoredFrom: input.version });
    return next;
  });
}

/** The standard words (version 1) become the draft. Nothing goes live. */
export async function resetDesignToStandard(input: RowChange): Promise<DesignRow> {
  return restoreDesignVersion({ ...input, version: 1 }, "EMAIL_DESIGN_RESET_TO_STANDARD_DRAFT");
}

export async function discardDesignDraft(input: RowChange): Promise<DesignRow> {
  requireDefinition(input.key);
  const key = designRowKey(input.key);
  return db.$transaction(async (tx) => {
    const row = parseDesignRow(await lockAndRead(tx, key));
    guardRevision(row, input.expectedRevision);
    if (!row.draft) return row;
    const next: DesignRow = { ...row, revision: row.revision + 1, draft: null };
    await write(tx, key, next);
    await auditDesign(tx, input.actor, "EMAIL_DESIGN_DRAFT_DISCARDED", input.key, { key: input.key });
    return next;
  });
}

/**
 * Publishes the draft as a new version (the route has already checked the
 * administrator's own PIN). Refused when the checks list has errors. A retry
 * with the same idempotency key returns the version it made.
 */
export async function publishDesign(input: RowChange & { idempotencyKey: string | null; change: string; theme: EmailTheme }): Promise<{ row: DesignRow; version: number }> {
  const definition = requireDefinition(input.key);
  refuseSecurity(definition);
  const key = designRowKey(input.key);
  return db.$transaction(async (tx) => {
    const row = parseDesignRow(await lockAndRead(tx, key));
    const repeat = input.idempotencyKey ? row.versions.find((item) => item.idempotencyKey === input.idempotencyKey) : undefined;
    if (repeat) return { row, version: repeat.version };
    guardRevision(row, input.expectedRevision);
    if (!row.draft) throw new EmailDesignError(409, "There is no draft to publish.");
    const failing = blockingChecks(checkDocument(definition, row.draft.doc, input.theme));
    if (failing.length) throw new EmailDesignError(400, `Fix the checks first: ${failing.map((check) => check.message).join(" ")}`, { checks: failing });
    const version = Math.max(1, ...row.versions.map((item) => item.version)) + 1;
    const record: DesignVersion = { version, doc: row.draft.doc, savedAt: new Date().toISOString(), actor: input.actor, change: input.change.trim().slice(0, 200), restoredFrom: row.draft.basedOn === (row.publishedVersion ?? 1) ? null : row.draft.basedOn, idempotencyKey: input.idempotencyKey };
    const before = { key: input.key, publishedVersion: row.publishedVersion ?? 1 };
    const next: DesignRow = { revision: row.revision + 1, publishedVersion: version, draft: null, versions: [...row.versions, record].slice(-HISTORY_LIMIT) };
    await write(tx, key, next);
    await auditDesign(tx, input.actor, "EMAIL_DESIGN_PUBLISHED", input.key, { key: input.key, version, restoredFrom: record.restoredFrom, change: record.change, document: row.draft.doc }, before);
    return { row: next, version };
  });
}

/* ---------------- Email look (theme) ---------------- */

export async function saveThemeDraft(input: { theme: unknown; expectedRevision: number; actor: DesignActor }): Promise<ThemeRow> {
  const theme = sanitizeTheme(input.theme);
  const problems = themeProblems(theme);
  if (problems.length) throw new EmailDesignError(400, problems.map((problem) => problem.message).join(" "), { problems });
  return db.$transaction(async (tx) => {
    const row = parseThemeRow(await lockAndRead(tx, EMAIL_LOOK_KEY));
    guardRevision(row, input.expectedRevision);
    const next: ThemeRow = { ...row, revision: row.revision + 1, draft: { theme, savedAt: new Date().toISOString(), actor: input.actor } };
    await write(tx, EMAIL_LOOK_KEY, next);
    return next;
  });
}

export async function discardThemeDraft(input: { expectedRevision: number; actor: DesignActor }): Promise<ThemeRow> {
  return db.$transaction(async (tx) => {
    const row = parseThemeRow(await lockAndRead(tx, EMAIL_LOOK_KEY));
    guardRevision(row, input.expectedRevision);
    if (!row.draft) return row;
    const next: ThemeRow = { ...row, revision: row.revision + 1, draft: null };
    await write(tx, EMAIL_LOOK_KEY, next);
    return next;
  });
}

/** Publishes the theme draft (PIN checked by the route). Every email uses it from the next send. */
export async function publishTheme(input: { expectedRevision: number; actor: DesignActor; idempotencyKey: string | null }): Promise<{ row: ThemeRow; version: number }> {
  return db.$transaction(async (tx) => {
    const row = parseThemeRow(await lockAndRead(tx, EMAIL_LOOK_KEY));
    const repeat = input.idempotencyKey ? row.versions.find((item) => item.idempotencyKey === input.idempotencyKey) : undefined;
    if (repeat) return { row, version: repeat.version };
    guardRevision(row, input.expectedRevision);
    if (!row.draft) throw new EmailDesignError(409, "There is no draft look to publish.");
    const problems = themeProblems(row.draft.theme);
    if (problems.length) throw new EmailDesignError(400, problems.map((problem) => problem.message).join(" "));
    const version = Math.max(1, ...row.versions.map((item) => item.version)) + 1;
    const before = row.versions.find((item) => item.version === row.publishedVersion)?.theme ?? DEFAULT_EMAIL_THEME;
    const next: ThemeRow = { revision: row.revision + 1, publishedVersion: version, draft: null, versions: [...row.versions, { version, theme: row.draft.theme, savedAt: new Date().toISOString(), actor: input.actor, idempotencyKey: input.idempotencyKey }].slice(-HISTORY_LIMIT) };
    await write(tx, EMAIL_LOOK_KEY, next);
    await tx.auditLog.create({ data: { userId: input.actor.id, action: "EMAIL_LOOK_PUBLISHED", entity: "AppSetting", entityId: EMAIL_LOOK_KEY, before: before as unknown as Prisma.InputJsonValue, after: { version, theme: row.draft.theme, actorRole: input.actor.role } as unknown as Prisma.InputJsonValue } });
    return { row: next, version };
  });
}
