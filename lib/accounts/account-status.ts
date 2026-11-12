/**
 * Disabling and activating an account, and the guards that protect the admin
 * set. Shared by `PATCH /api/admin/users/[id]` and the Accounts bulk route so
 * the two can never apply different rules.
 *
 * Guards (all pre-existing except the last, which closes a race):
 *  - you cannot disable your own account;
 *  - disabling logs the person out (their sessions are deleted);
 *  - the last active admin cannot be disabled or demoted. An admin can never
 *    disable themselves, but two admins disabling each other at the same
 *    moment could leave nobody able to administer the system. The check runs
 *    inside the write's transaction under one advisory lock, so concurrent
 *    attempts are serialised and the second one is refused.
 */
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";

export const ADMIN_SET_LOCK_KEY = "accounts:active-admin-set";

/** A refusal the route answers with 400 and the message as written. */
export class AccountGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountGuardError";
  }
}

export const LAST_ADMIN_MESSAGE = "This is the last active admin account. Make someone else an admin before disabling or changing this one.";

type Tx = Prisma.TransactionClient;

/**
 * Refuse when removing `targetId` from the active admin set would leave none.
 * Call inside the transaction that makes the change.
 */
export async function assertAnotherActiveAdmin(tx: Tx, targetId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMIN_SET_LOCK_KEY}))`;
  const others = await tx.user.count({ where: { role: Role.ADMIN, isActive: true, id: { not: targetId } } });
  if (others === 0) throw new AccountGuardError(LAST_ADMIN_MESSAGE);
}

/** True when the change takes an active admin out of the active admin set. */
export function leavesAdminSet(existing: { role: Role; isActive: boolean }, next: { role?: Role | null; isActive?: boolean }): boolean {
  if (existing.role !== Role.ADMIN || !existing.isActive) return false;
  return next.isActive === false || (next.role != null && next.role !== Role.ADMIN);
}

export type SetActiveResult = { id: string; isActive: boolean; changed: boolean };

/**
 * Disable or activate one account with the same effects as the account PATCH:
 * sessions dropped on disable, audited as UPDATE_USER_ACCOUNT.
 */
export async function setAccountActive(actorId: string, userId: string, isActive: boolean): Promise<SetActiveResult> {
  if (userId === actorId && !isActive) throw new AccountGuardError("You cannot disable your own account.");
  const existing = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, isActive: true, clientId: true } });
  if (!existing) throw new AccountGuardError("User not found.");
  if (existing.isActive === isActive) return { id: existing.id, isActive, changed: false };

  await db.$transaction(async (tx) => {
    if (leavesAdminSet(existing, { isActive })) await assertAnotherActiveAdmin(tx, existing.id);
    await tx.user.update({ where: { id: userId }, data: { isActive }, select: { id: true } });
    if (!isActive) await tx.session.deleteMany({ where: { userId } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "UPDATE_USER_ACCOUNT",
        entity: "User",
        entityId: userId,
        before: existing as unknown as Prisma.InputJsonValue,
        after: { isActive },
      },
    });
  });
  return { id: existing.id, isActive, changed: true };
}
