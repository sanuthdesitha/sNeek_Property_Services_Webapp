import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { canActAs, heldRoles, resolveActiveRole } from "@/lib/auth/roles";
import { readActiveRoleCookie } from "@/lib/auth/active-role";
import { resolveImpersonation } from "./impersonation-server";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    // extraRoles is read on EVERY request rather than cached in the JWT, for the
    // same reason the role itself is: an admin revoking somebody's QA hat has to
    // take effect now, not at their next sign-in.
    select: { id: true, isActive: true, role: true, extraRoles: { select: { role: true } } },
  });
  if (!user?.isActive) {
    throw new Error("UNAUTHORIZED");
  }

  // MAY I? is answered against every role they hold. WHERE AM I? is answered
  // against the one they are currently acting as. `session.user.role` carries
  // the active role because that is what presentation reads, and for anyone
  // with no extra roles it is identical to their primary — so nothing changes
  // for an account that has always had one job.
  const held = heldRoles(
    user.role,
    user.extraRoles.map((row) => row.role)
  );
  const activeRole = resolveActiveRole(held, readActiveRoleCookie(), user.role);

  session.user.role = activeRole;
  session.user.primaryRole = user.role;
  session.user.heldRoles = held;

  // Admin "test as": swap the session's identity for the impersonated user so
  // every downstream query (which reads session.user.id / .role and knows
  // nothing about this feature) returns exactly what that user would see.
  // resolveImpersonation re-verifies the actor is still an active ADMIN, so the
  // swap can only happen for someone who could already read all of this data.
  // `realUser` is preserved for the banner and for audit at the point of use.
  const impersonation = await resolveImpersonation(user.id);
  if (impersonation) {
    // The target's roles replace the actor's ENTIRELY. Merging them would let an
    // admin impersonating a cleaner keep their own admin reach, which is the
    // opposite of what "view as this person" means — and heldRoles is what
    // requireRole now consults, so a leftover entry would be a live grant.
    session.user = {
      ...session.user,
      id: impersonation.target.id,
      name: impersonation.target.name,
      email: impersonation.target.email,
      role: impersonation.target.role,
      primaryRole: impersonation.target.role,
      heldRoles: [impersonation.target.role],
    };
    session.impersonation = {
      actorId: impersonation.actor.id,
      actorName: impersonation.actor.name,
      actorEmail: impersonation.actor.email,
      mode: impersonation.mode,
      startedAt: impersonation.ticket.startedAt,
    };
  }

  return session;
}

/**
 * The genuinely signed-in user, ignoring any impersonation. Use this — never
 * `requireSession()` — for anything that must be attributed to the human at
 * the keyboard, and for the impersonation endpoints themselves (otherwise an
 * impersonated CLEANER session would fail the ADMIN check needed to stop
 * impersonating).
 */
export async function requireRealSession() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, isActive: true, role: true },
  });
  if (!user?.isActive) {
    throw new Error("UNAUTHORIZED");
  }
  session.user.role = user.role;
  return session;
}

/**
 * MAY I? — answered against every role this person HOLDS, not just the one they
 * are currently acting as.
 *
 * Somebody who genuinely is a QA inspector is one whichever hat they have on.
 * Refusing them until they flick the switcher would add no safety — flicking it
 * takes a click — and would break every cross-portal link and background fetch
 * in the app.
 *
 * For an account with no extra roles, `heldRoles` is `[primary]` and this is
 * byte-for-byte the check it always was.
 *
 * WHAT THIS DOES NOT DECIDE: whether the act itself is allowed. Holding both
 * CLEANER and QA_INSPECTOR is legitimate; inspecting your own clean is not, and
 * that is guarded per-job in lib/qa/self-review.ts. A role gate cannot see a
 * conflict that depends on who cleaned which property.
 */
export async function requireRole(allowedRoles: Role[]) {
  const session = await requireSession();
  if (!canActAs(session.user.heldRoles ?? [session.user.role as Role], allowedRoles)) {
    throw new Error("FORBIDDEN");
  }
  return session;
}

// Type augmentation for session
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      /**
       * The role this person is currently ACTING AS. Equal to `primaryRole` for
       * anyone who holds only one, which is why 133 existing direct reads of
       * this field keep working unchanged.
       */
      role: Role;
      /** Their real job — the one that decides which portal is home. */
      primaryRole?: Role;
      /** Every role they may act as. `requireRole` is answered against this. */
      heldRoles?: Role[];
    };
    /**
     * Present ONLY while an admin is viewing the app as another user. Its
     * presence is what the warning banner keys off; absent means `user` is the
     * genuine signed-in identity.
     */
    impersonation?: {
      actorId: string;
      actorName?: string | null;
      actorEmail?: string | null;
      mode: "READ_ONLY" | "FULL";
      startedAt: number;
    };
  }
}
