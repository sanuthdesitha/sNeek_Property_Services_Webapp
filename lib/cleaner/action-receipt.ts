import { createHash } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { cleanerDraftIdentity } from "./draft-identity";
import { withSharedCleanerJobDraftLock } from "./shared-job-draft";
import { z } from "zod";
import { actionResultSchema, CLEANER_ACTIONS, type CleanerAction } from "./action-contract";
import { heldRolesOf } from "@/lib/auth/role-query";
export { CLEANER_ACTIONS } from "./action-contract";

type Session = { user: { id: string }; impersonation?: { actorId: string; mode?: "READ_ONLY" | "FULL" } | null };
type Result = { status: number; body: Record<string, unknown> };
type Receipt = { version: 1; identity: string; action: CleanerAction; requestId: string; digest: string | null;
  state: "COMMITTED" | "CANCELLED"; result: Result; createdAt: string };
const receiptSchema = z.object({ version: z.literal(1), identity: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(CLEANER_ACTIONS),
  requestId: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), state: z.enum(["COMMITTED", "CANCELLED"]),
  result: actionResultSchema, createdAt: z.string().datetime(),
}).strict().refine(value => value.state === "CANCELLED" ? value.digest === null && value.result.status === 409 : value.digest !== null)
  .refine(value => value.result.status >= 300 || value.result.body.ok === true);
export class ActionReceiptError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function actionBodyDigest(body: unknown) { return createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex"); }
export function actionRequestId(value: string | null) {
  if (value !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ActionReceiptError("Invalid action request identity.", 400);
  return value?.toLowerCase() ?? null;
}
type Context = { session: Session; jobId: string; action: CleanerAction; requestId: string | null; body: unknown; draftIdentity?: string | null };
function identityKey(context: Context) {
  const identity = cleanerDraftIdentity(context.session, context.jobId);
  if (context.requestId && context.draftIdentity !== identity) throw new ActionReceiptError("Account context changed. Reload this job.");
  const key = `cleaner_action_v1:${createHash("sha256").update(JSON.stringify([identity, context.action, context.requestId])).digest("hex")}`;
  return { identity, key };
}
async function lockContext(tx: Prisma.TransactionClient, context: Context, receipt: Receipt | null = null) {
  // Serializing this cleaner also prevents concurrent starts on different jobs.
  // Domain order: draft -> actor -> job -> assignments.
  const userIds = Array.from(new Set([context.session.user.id, context.session.impersonation?.actorId].filter((id): id is string => Boolean(id)))).sort();
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${Prisma.join(userIds)}) ORDER BY "id" FOR UPDATE`;
  await tx.$queryRaw`SELECT "userId" FROM "UserRole" WHERE "userId" IN (${Prisma.join(userIds)}) ORDER BY "userId", "role" FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: context.session.user.id }, select: { isActive: true, role: true, extraRoles: { select: { role: true } } } });
  if (!user?.isActive || !heldRolesOf(user).includes(Role.CLEANER)) throw new ActionReceiptError("Cleaner access has changed.", 403);
  if (context.session.impersonation) {
    const actor = await tx.user.findUnique({ where: { id: context.session.impersonation.actorId }, select: { role: true, isActive: true } });
    // Match canonical impersonation: active primary ADMIN, FULL mode, and the
    // target's current primary role (extra roles are not impersonated).
    if (context.session.impersonation.mode !== "FULL" || !actor?.isActive || actor.role !== Role.ADMIN || user.role !== Role.CLEANER) throw new ActionReceiptError("Impersonation authority has changed.", 403);
  }
  await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${context.jobId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "JobAssignment" WHERE "jobId" = ${context.jobId} ORDER BY "id" FOR UPDATE`;
  const assignment = await tx.jobAssignment.findFirst({ where: { jobId: context.jobId, userId: context.session.user.id, removedAt: null }, select: { id: true } });
  if (assignment) return;
  // A decline/transfer removes this assignment. Only its own committed terminal
  // receipt remains readable; it grants no new mutation or job read access.
  const terminal = receipt?.state === "COMMITTED" && receipt.action === "assignment-response" && receipt.result.status === 200
    ? receipt.result.body.assignmentStatus : null;
  if (terminal === "DECLINED" || terminal === "TRANSFERRED") {
    const historical = await tx.jobAssignment.findFirst({ where: { jobId: context.jobId, userId: context.session.user.id, responseStatus: terminal, removedAt: { not: null } }, select: { id: true } });
    if (historical) return;
  }
  throw new ActionReceiptError("Not actively assigned to this job.", 403);
}
async function readReceipt(tx: Prisma.TransactionClient, key: string): Promise<Receipt | null> {
  const row = await tx.appSetting.findUnique({ where: { key }, select: { value: true } });
  if (!row) return null;
  const parsed = receiptSchema.safeParse(row.value);
  if (!parsed.success) {
    throw new ActionReceiptError("Stored action receipt is unavailable.", 500);
  }
  return parsed.data;
}
async function writeReceipt(tx: Prisma.TransactionClient, key: string, receipt: Receipt) {
  receiptSchema.parse(receipt);
  await tx.appSetting.create({ data: { key, value: receipt as unknown as Prisma.InputJsonValue } });
}

/** Receipts and cancellation fences have no timed deletion policy. */
export async function withCleanerAction<T extends Result>(context: Context, mutate: (tx: Prisma.TransactionClient) => Promise<T>): Promise<Result> {
  context = { ...context, requestId: actionRequestId(context.requestId) };
  const { identity, key } = identityKey(context);
  return withSharedCleanerJobDraftLock(context.jobId, async tx => {
    const receipt = context.requestId ? await readReceipt(tx, key) : null;
    await lockContext(tx, context, receipt);
    const digest = actionBodyDigest(context.body);
    if (context.requestId) {
      if (receipt) {
        if (receipt.identity !== identity || receipt.action !== context.action || receipt.requestId !== context.requestId) throw new ActionReceiptError("Action context changed.");
        if (receipt.state === "CANCELLED") throw new ActionReceiptError("This request was cancelled during recovery. Check the current status before making a new request.");
        if (receipt.digest !== digest) throw new ActionReceiptError("This request identity was already used for different input.");
        return receipt.result;
      }
    }
    const result = await mutate(tx);
    if (context.requestId) await writeReceipt(tx, key, { version: 1, identity, action: context.action, requestId: context.requestId,
      digest, state: "COMMITTED", result, createdAt: new Date().toISOString() });
    return result;
  }, undefined, { timeout: 20_000 });
}

/** Taking the same lock and writing a fence makes a late original request inert. */
export async function recoverCleanerAction(context: Context) {
  context = { ...context, requestId: actionRequestId(context.requestId) };
  if (!context.requestId) throw new ActionReceiptError("Action identity is required.", 400);
  const { identity, key } = identityKey(context);
  return withSharedCleanerJobDraftLock(context.jobId, async tx => {
    const existing = await readReceipt(tx, key);
    await lockContext(tx, context, existing);
    if (existing) {
      if (existing.identity !== identity || existing.action !== context.action || existing.requestId !== context.requestId ||
        (existing.digest !== null && existing.digest !== actionBodyDigest(context.body))) throw new ActionReceiptError("Action context or input changed.");
      return { state: existing.state, result: existing.result };
    }
    const result = { status: 409, body: { error: "Original request cancelled during recovery." } };
    await writeReceipt(tx, key, { version: 1, identity, action: context.action, requestId: context.requestId!, digest: null,
      state: "CANCELLED", result, createdAt: new Date().toISOString() });
    return { state: "CANCELLED" as const, result };
  });
}
