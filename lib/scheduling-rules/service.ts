import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { requireDelegatedAction, DelegatedActionDenied } from "@/lib/rbac/delegated-admin";
import { verifySensitiveAction, type SensitiveActionCredentials } from "@/lib/security/admin-verification";
import { buildRuleBook, earliestEffectiveFrom } from "./book";
import { takeSchedulingRuleSnapshot } from "./backup";
import { checksumOf, decodeVersionRow, loadSchedulingRuleBook, SCHEDULING_RULES_SCHEMA_VERSION, withRulesLock } from "./store";
import { canonicalRuleValues, diffRuleValues, validateRuleValues, type SchedulingRuleValues } from "./values";

/**
 * The LOCKED edit flow for the scheduling rules (owner decision 2026-11-14:
 * "keep them safe and locked").
 *
 *  1. Unlock: ADMIN (or a person an ADMIN granted scheduling.rules_edit),
 *     never while testing as someone, confirmed with the person's OWN PIN.
 *     Gives a short server-side unlock bound to that person.
 *  2. Draft, review (plain diff + dry-run preview) — client side, nothing saved.
 *  3. Publish: the unlock, the PIN AGAIN, a reason, a confirmed two-step
 *     review, an effective day no earlier than tomorrow, the version the
 *     review was based on (409 when someone published since), and a 10-minute
 *     cool-down. An automatic snapshot is taken first; the new version and the
 *     audit row are written in the same locked transaction.
 * A restore or an import is the same publish with kind RESTORE / IMPORT.
 */
export const UNLOCK_MINUTES = 15;
export const PUBLISH_COOL_DOWN_MINUTES = 10;
const UNLOCK_KEY_PREFIX = "scheduling_rules_unlock:";

export class RulesEditError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly detail?: Record<string, unknown>) {
    super(message);
    this.name = "RulesEditError";
  }
}

const fail = (status: number, code: string, message: string, detail?: Record<string, unknown>): never => {
  throw new RulesEditError(status, code, message, detail);
};

/** Who may change the rules: refuses everyone else, and everyone while testing as someone. */
export async function requireRulesEditor(session: Session): Promise<{ id: string }> {
  try {
    const actor = await requireDelegatedAction(session, "scheduling.rules_edit");
    return { id: actor.id };
  } catch (error) {
    if (error instanceof DelegatedActionDenied) fail(error.status, "NOT_ALLOWED", error.message);
    throw error;
  }
}

/** Whether this session could change the rules (for showing the Unlock button). Never throws. */
export async function canEditRules(session: Session): Promise<boolean> {
  try {
    await requireDelegatedAction(session, "scheduling.rules_edit");
    return true;
  } catch {
    return false;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type UnlockRow = { tokenHash: string; expiresAt: string };

export async function unlockRules(session: Session, credentials: SensitiveActionCredentials, now: Date = new Date()): Promise<{ token: string; expiresAt: string }> {
  const actor = await requireRulesEditor(session);
  await verifySensitiveAction(actor.id, credentials, "scheduling.rules_edit");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + UNLOCK_MINUTES * 60_000).toISOString();
  const value: UnlockRow = { tokenHash: hashToken(token), expiresAt };
  await db.appSetting.upsert({
    where: { key: `${UNLOCK_KEY_PREFIX}${actor.id}` },
    create: { key: `${UNLOCK_KEY_PREFIX}${actor.id}`, value },
    update: { value },
  });
  await db.auditLog.create({ data: { userId: actor.id, action: "SCHEDULING_RULES_UNLOCKED", entity: "SchedulingRules", entityId: "unlock", after: { expiresAt } } });
  return { token, expiresAt };
}

export async function lockRules(session: Session): Promise<void> {
  const actor = await requireRulesEditor(session);
  await db.appSetting.deleteMany({ where: { key: `${UNLOCK_KEY_PREFIX}${actor.id}` } });
}

/** The unlock must exist, belong to this person, match and not have expired. */
export async function assertUnlocked(actorId: string, token: string | null | undefined, now: Date = new Date()): Promise<void> {
  if (!token) fail(423, "LOCKED", "The scheduling rules are locked. Unlock them with your PIN first.");
  const row = await db.appSetting.findUnique({ where: { key: `${UNLOCK_KEY_PREFIX}${actorId}` }, select: { value: true } });
  const value = row?.value as UnlockRow | undefined;
  if (!value || typeof value.tokenHash !== "string" || value.tokenHash !== hashToken(token!)) {
    fail(423, "LOCKED", "The scheduling rules are locked. Unlock them with your PIN first.");
  }
  if (new Date(value!.expiresAt).getTime() <= now.getTime()) fail(423, "UNLOCK_EXPIRED", "Your unlock has expired. Unlock again with your PIN.");
}

export type PublishInput = {
  token: string;
  credentials: SensitiveActionCredentials;
  values?: unknown;
  effectiveFrom: string;
  reason: string;
  expectedLatestVersion: number;
  appliesToExisting: boolean;
  confirmed: boolean;
  kind: "EDIT" | "RESTORE" | "IMPORT";
  restoredFromVersion?: number | null;
};

export type PublishResult = { version: number; effectiveFrom: string; snapshotId: string };

export async function publishRules(session: Session, input: PublishInput, now: Date = new Date()): Promise<PublishResult> {
  const actor = await requireRulesEditor(session);
  await assertUnlocked(actor.id, input.token, now);
  if (input.confirmed !== true) fail(400, "CONFIRM_REQUIRED", "Review the changes and confirm before publishing.");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 8) fail(400, "REASON_REQUIRED", "Say why the rules are changing (at least 8 characters).");
  if (reason.length > 1000) fail(400, "REASON_TOO_LONG", "Keep the reason under 1,000 characters.");
  const earliest = earliestEffectiveFrom(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom ?? "") || input.effectiveFrom < earliest) {
    fail(400, "EFFECTIVE_TOO_EARLY", `Choose an effective day from ${earliest} (tomorrow) onwards. Past and today's work is never re-planned.`);
  }
  const validated = validateRuleValues(input.values);
  if (!validated.ok) fail(400, "INVALID_VALUES", "Some values are not allowed.", { problems: validated.problems });
  const values = (validated as { ok: true; values: SchedulingRuleValues }).values;
  // PIN again at the moment of publishing (the unlock alone is not enough).
  await verifySensitiveAction(actor.id, input.credentials, "scheduling.rules_edit");

  return withRulesLock(async (tx) => {
    // Seeds/activates through the same lock holder (the read joins this transaction).
    const book = buildRuleBook((await tx.schedulingRuleVersion.findMany({ orderBy: { version: "asc" } })).map(decodeVersionRow), now);
    const latest = book.versions[book.versions.length - 1];
    if (latest.version !== input.expectedLatestVersion) {
      fail(409, "STALE", `The rules changed since you opened them (now version ${latest.version}). Reload and review again; your draft is kept.`, { latestVersion: latest.version });
    }
    const lastPublished = [...book.versions].reverse().find((record) => record.kind !== "ORIGINAL");
    if (lastPublished && now.getTime() - lastPublished.createdAt.getTime() < PUBLISH_COOL_DOWN_MINUTES * 60_000) {
      const retryAt = new Date(lastPublished.createdAt.getTime() + PUBLISH_COOL_DOWN_MINUTES * 60_000).toISOString();
      fail(429, "COOL_DOWN", `Rules were published less than ${PUBLISH_COOL_DOWN_MINUTES} minutes ago. Try again after ${retryAt}.`, { retryAt });
    }
    const changes = diffRuleValues(latest.values, values);
    if (changes.length === 0) fail(400, "NO_CHANGE", "Nothing would change: these values are the same as the latest version.");
    if (input.kind === "RESTORE") {
      const source = book.versions.find((record) => record.version === input.restoredFromVersion);
      if (!source) fail(404, "VERSION_NOT_FOUND", "That version no longer exists.");
      if (diffRuleValues(source!.values, values).length > 0) fail(400, "RESTORE_MISMATCH", "A restore must use exactly the values of the version being restored.");
    }
    const snapshot = await takeSchedulingRuleSnapshot({ source: "PRE_PUBLISH", actorId: actor.id, client: tx, book });
    const version = latest.version + 1;
    const checksum = checksumOf(values);
    await tx.schedulingRuleVersion.create({
      data: {
        version,
        kind: input.kind,
        values: canonicalRuleValues(values) as Prisma.InputJsonObject,
        schemaVersion: SCHEDULING_RULES_SCHEMA_VERSION,
        checksum,
        effectiveFrom: input.effectiveFrom,
        appliesToExisting: input.appliesToExisting === true,
        reason,
        restoredFromVersion: input.kind === "RESTORE" ? input.restoredFromVersion ?? null : null,
        createdById: actor.id,
        createdAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "SCHEDULING_RULES_PUBLISHED",
        entity: "SchedulingRules",
        entityId: String(version),
        before: { version: latest.version, values: canonicalRuleValues(latest.values) } as Prisma.InputJsonObject,
        after: {
          version,
          kind: input.kind,
          effectiveFrom: input.effectiveFrom,
          appliesToExisting: input.appliesToExisting === true,
          reason,
          restoredFromVersion: input.restoredFromVersion ?? null,
          changes: changes.map((change) => ({ key: change.key, from: change.from, to: change.to })),
          snapshotId: snapshot.id,
          checksum,
          values: canonicalRuleValues(values),
        } as Prisma.InputJsonObject,
      },
    });
    return { version, effectiveFrom: input.effectiveFrom, snapshotId: snapshot.id };
  });
}

/** Record that someone looked at the rules (at most once per person per 10 minutes). */
export async function recordRulesViewed(userId: string, now: Date = new Date()): Promise<void> {
  const recent = await db.auditLog.findFirst({
    where: { userId, action: "SCHEDULING_RULES_VIEWED", createdAt: { gte: new Date(now.getTime() - 10 * 60_000) } },
    select: { id: true },
  });
  if (recent) return;
  await db.auditLog.create({ data: { userId, action: "SCHEDULING_RULES_VIEWED", entity: "SchedulingRules", entityId: "view" } });
}

export { loadSchedulingRuleBook };
