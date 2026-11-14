import "server-only";
import type { Session } from "next-auth";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import type { AccountCreator } from "./create-account-rules";

/**
 * Who is creating an account, read live for this request: every role the
 * signed-in person holds, whether they are testing as someone else, and an
 * operations manager's Hiring pack level (administrators never inherit packs).
 */
export type ResolvedAccountCreator = AccountCreator & { id: string; actorRole: "ADMIN" | "OPS_MANAGER" | null };

export async function resolveAccountCreator(session: Session): Promise<ResolvedAccountCreator> {
  const heldRoles = (session.user.heldRoles ?? [session.user.role]).map(String);
  const impersonating = Boolean(session.impersonation);
  const admin = heldRoles.includes("ADMIN");
  const levels = admin || impersonating ? null : await getOpsAccess({ id: session.user.id, role: String(session.user.role), heldRoles });
  return {
    id: session.user.id,
    heldRoles,
    impersonating,
    hiringLevel: levels ? levels.hiring : null,
    actorRole: admin ? "ADMIN" : heldRoles.includes("OPS_MANAGER") ? "OPS_MANAGER" : null,
  };
}
