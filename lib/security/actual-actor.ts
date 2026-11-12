import "server-only";
/**
 * THE ACTUAL ACTOR RULE for sensitive-action verification.
 *
 * A PIN proves who is at the keyboard, so it is only ever checked against the
 * genuinely signed-in person's own PIN:
 *   - the account whose PIN is checked must be the signed-in account (never
 *     another person's, whatever id a caller passes);
 *   - never while that person is testing as someone else ("Test as"), where
 *     `requireSession()` swaps the session to the target — checking the target's
 *     PIN would be using another person's PIN.
 *
 * Read live on every call from the signed session and the impersonation ticket.
 */
import { getSession } from "@/lib/auth/session";
import { resolveImpersonation } from "@/lib/auth/impersonation-server";

export type ActualActorRefusal = "UNAUTHORIZED" | "ACTUAL_ACTOR_REQUIRED";

/** Null when `userId` is the signed-in person acting as themselves; otherwise why not. */
export async function actualActorRefusal(userId: string): Promise<ActualActorRefusal | null> {
  let realUserId: string | null = null;
  try {
    const session = await getSession();
    realUserId = session?.user?.id ?? null;
  } catch {
    // No request scope: nobody is signed in, so nobody can be verified.
    return "UNAUTHORIZED";
  }
  if (!realUserId) return "UNAUTHORIZED";
  if (realUserId !== userId) return "ACTUAL_ACTOR_REQUIRED";
  if (await resolveImpersonation(realUserId)) return "ACTUAL_ACTOR_REQUIRED";
  return null;
}
