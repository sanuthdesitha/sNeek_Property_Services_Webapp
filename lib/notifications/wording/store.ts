import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getDefaultEmailTemplates, type AppEmailTemplateKey } from "@/lib/email-templates";
import { getTransactionAppSettings, saveAppSettings } from "@/lib/settings";
import { checkWording, fromEmailTemplateSyntax, toEmailTemplateSyntax, wordingHash, type WordingProblem } from "./template";
import { wordingDefinition, wordingPart } from "./registry";
import { entryKey, partFields, type WordingFields, type WordingPartDefinition, type WordingTransport } from "./types";

/**
 * The wording override store. One AppSetting row per notification type
 * (`notificationWording:<typeKey>`, no schema change), holding every part's
 * version history; the last version is live. Version 1 is always the default
 * and is never stored. Email-template parts write their live text to the
 * existing shared template (`settings.emailTemplates`), so Forms and every
 * existing renderer see the same wording; this row keeps their history.
 */
export const WORDING_KEY_PREFIX = "notificationWording:";
const HISTORY_LIMIT = 60;

export type WordingKind = "EDIT" | "RESTORE" | "RESET";
export type WordingActor = { id: string; name: string | null; role: string };

export type StoredVersion = {
  version: number;
  /** null = back to the default. */
  fields: WordingFields | null;
  savedAt: string;
  actor: WordingActor;
  kind: WordingKind;
  change: string;
};

type StoredRow = { entries: Record<string, StoredVersion[]> };

export function wordingRowKey(typeKey: string): string {
  return `${WORDING_KEY_PREFIX}${typeKey}`;
}

function cleanFields(value: unknown): WordingFields | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const fields: WordingFields = {};
  for (const name of ["title", "body", "subject"] as const) if (typeof row[name] === "string") fields[name] = row[name] as string;
  return fields;
}

/** Malformed versions are dropped; a broken row can only fall back to the default. */
export function parseStoredRow(value: unknown): StoredRow {
  const entries: StoredRow["entries"] = {};
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as { entries?: unknown }).entries : null;
  if (!raw || typeof raw !== "object") return { entries };
  for (const [key, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    entries[key] = list.flatMap((item): StoredVersion[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.version !== "number" || typeof row.savedAt !== "string") return [];
      const actor = (row.actor ?? {}) as Partial<WordingActor>;
      const kind = row.kind === "RESTORE" || row.kind === "RESET" ? row.kind : "EDIT";
      return [{ version: row.version, fields: row.fields === null ? null : cleanFields(row.fields), savedAt: row.savedAt, actor: { id: String(actor.id ?? ""), name: typeof actor.name === "string" ? actor.name : null, role: String(actor.role ?? "") }, kind, change: typeof row.change === "string" ? row.change : "" }];
    });
  }
  return { entries };
}

export async function readStoredRow(typeKey: string): Promise<StoredRow> {
  const row = await db.appSetting.findUnique({ where: { key: wordingRowKey(typeKey) }, select: { value: true } });
  return parseStoredRow(row?.value);
}

/** Default wording of a part (email-template parts: the shipped template). */
export function partDefaults(part: WordingPartDefinition): WordingFields {
  if (part.source.kind === "EMAIL_TEMPLATE") {
    const template = getDefaultEmailTemplates()[part.source.key];
    return { subject: fromEmailTemplateSyntax(template.subject), body: fromEmailTemplateSyntax(template.html) };
  }
  return part.defaults;
}

export function emailTemplateFields(templates: Record<string, { subject: string; html: string }>, key: AppEmailTemplateKey): WordingFields {
  const template = templates[key] ?? getDefaultEmailTemplates()[key];
  return { subject: fromEmailTemplateSyntax(template.subject), body: fromEmailTemplateSyntax(template.html) };
}

export function partProblems(part: WordingPartDefinition, fields: WordingFields): WordingProblem[] {
  return checkWording({ transport: part.transport, fields, fieldNames: partFields(part), allowed: part.variables, required: part.required });
}

/** The live override of a store part, or null (default / invalid → default). */
export function liveStoreOverride(row: StoredRow, part: WordingPartDefinition): WordingFields | null {
  const history = row.entries[entryKey(part.id, part.transport)] ?? [];
  const live = history[history.length - 1];
  if (!live?.fields) return null;
  return partProblems(part, live.fields).length ? null : live.fields;
}

export class WordingConflictError extends Error {
  readonly status = 409;
  constructor() { super("This wording changed since you opened it (here or in Forms). Reload to see the current version; your draft is kept."); }
}

export class WordingInvalidError extends Error {
  readonly status = 400;
  constructor(readonly problems: WordingProblem[]) { super(problems.map((problem) => problem.message).join(" ")); }
}

export class WordingNotFoundError extends Error {
  readonly status = 404;
  constructor(message = "This notification has no editable wording for that part.") { super(message); }
}

export type SaveWordingInput = {
  typeKey: string;
  partId: string;
  transport: WordingTransport;
  kind: WordingKind;
  /** EDIT: the new wording. RESTORE: ignored (the version's fields are used). RESET: ignored. */
  fields?: WordingFields;
  restoreVersion?: number;
  /** The live hash the editor loaded; anything else is a stale write (409). */
  expectedHash: string;
  change?: string;
  actor: WordingActor;
};

export type SaveWordingResult = { version: number; hash: string };

function nextFields(input: SaveWordingInput, part: WordingPartDefinition, history: StoredVersion[]): WordingFields | null {
  if (input.kind === "RESET") return null;
  if (input.kind === "RESTORE") {
    if (input.restoreVersion === 1) return null;
    const found = history.find((item) => item.version === input.restoreVersion);
    if (!found) throw new WordingNotFoundError("That version no longer exists.");
    return found.fields;
  }
  const fields: WordingFields = {};
  for (const name of partFields(part)) fields[name] = part.source.kind === "EMAIL_TEMPLATE" ? (input.fields?.[name] ?? "").trim() : input.fields?.[name] ?? "";
  return fields;
}

/**
 * Saves a new version (edit, restore or reset). Refuses invalid wording (400)
 * and a stale write (409). Audited with before, after, actor and role.
 */
export async function saveWording(input: SaveWordingInput): Promise<SaveWordingResult> {
  const part = wordingPart(input.typeKey, input.partId, input.transport);
  if (!part || wordingDefinition(input.typeKey)?.status === "IN_CODE") throw new WordingNotFoundError();
  const key = wordingRowKey(input.typeKey);
  const entry = entryKey(part.id, part.transport);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const stored = await tx.appSetting.findUnique({ where: { key }, select: { value: true } });
    const row = parseStoredRow(stored?.value);
    const history = row.entries[entry] ?? [];
    const settings = part.source.kind === "EMAIL_TEMPLATE" ? await getTransactionAppSettings(tx) : null;
    const liveBefore = part.source.kind === "EMAIL_TEMPLATE"
      ? emailTemplateFields(settings!.emailTemplates, part.source.key)
      : liveStoreOverride(row, part) ?? partDefaults(part);
    if (wordingHash(liveBefore) !== input.expectedHash) throw new WordingConflictError();
    const fields = nextFields(input, part, history);
    const effective = fields ?? partDefaults(part);
    const problems = partProblems(part, effective);
    if (problems.length) throw new WordingInvalidError(problems);
    const version = Math.max(1, ...history.map((item) => item.version)) + 1;
    const record: StoredVersion = { version, fields, savedAt: new Date().toISOString(), actor: input.actor, kind: input.kind, change: (input.change ?? "").trim().slice(0, 200) };
    const nextRow: StoredRow = { entries: { ...row.entries, [entry]: [...history, record].slice(-HISTORY_LIMIT) } };
    if (part.source.kind === "EMAIL_TEMPLATE") {
      const templateKey = part.source.key;
      const written = { subject: toEmailTemplateSyntax(effective.subject ?? ""), html: toEmailTemplateSyntax(effective.body ?? "") };
      await saveAppSettings({ emailTemplates: { ...settings!.emailTemplates, [templateKey]: written } });
    }
    await tx.appSetting.upsert({ where: { key }, create: { key, value: nextRow as unknown as Prisma.InputJsonValue }, update: { value: nextRow as unknown as Prisma.InputJsonValue } });
    await tx.auditLog.create({ data: {
      userId: input.actor.id, action: "NOTIFICATION_WORDING_UPDATED", entity: "AppSetting", entityId: key,
      before: { typeKey: input.typeKey, part: part.id, transport: part.transport, fields: liveBefore } as Prisma.InputJsonValue,
      after: { typeKey: input.typeKey, part: part.id, transport: part.transport, version, kind: input.kind, restoredFrom: input.restoreVersion ?? null, fields: effective, actorRole: input.actor.role, change: record.change } as Prisma.InputJsonValue,
    } });
    return { version, hash: wordingHash(effective) };
  });
}
