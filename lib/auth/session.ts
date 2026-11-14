import { enforceOpsRequest } from "@/lib/rbac/ops-access";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { pageDenialDestination, REQUEST_PATH_HEADER } from "./page-denial";
import { authOptions } from "./auth-options";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { canActAs, heldRoles, resolveActiveRole } from "@/lib/auth/roles";
import { readActiveRoleCookie } from "@/lib/auth/active-role";
import { resolveImpersonation } from "./impersonation-server";
import { resolveRouteRole } from "./route-role";
import { recordLastSeen } from "./last-seen";
import { TWO_STEP_SETUP_PATH, isAdminPortalPage, pageExemptFromTwoStep, twoStepRequirement } from "./two-step-policy";

function currentRequestPath(): string | null {
  try {
    return headers().get(REQUEST_PATH_HEADER);
  } catch {
    return null;
  }
}

/**
 * Two-step sign-in requirement for administrators (lib/auth/two-step-policy.ts):
 * starts the grace period the first time an administrator without two-step
 * opens an admin page, and after it sends every admin page except Your
 * profile to the setup card. API routes are never refused here, so the 2FA
 * endpoints, sign-out and recovery keep working.
 */
async function enforceTwoStepRequirement(
  user: { id: string; twoFactorEnabled: boolean; twoStepRequiredSince: Date | null },
  held: Role[],
): Promise<void> {
  const path = currentRequestPath();
  if (!isAdminPortalPage(path)) return;
  const holdsAdmin = held.includes(Role.ADMIN);
  if (!holdsAdmin || user.twoFactorEnabled) return;
  let requiredSince = user.twoStepRequiredSince;
  if (!requiredSince) {
    requiredSince = new Date();
    await db.user
      .updateMany({ where: { id: user.id, twoStepRequiredSince: null }, data: { twoStepRequiredSince: requiredSince } })
      .catch(() => undefined);
  }
  const state = twoStepRequirement({ holdsAdmin, holdsOpsManager: held.includes(Role.OPS_MANAGER), twoFactorEnabled: false, requiredSince });
  if (state.kind === "setup_required" && !pageExemptFromTwoStep(path)) redirect(TWO_STEP_SETUP_PATH);
}

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) {
    // A page request with a signed-out (or signed-out-elsewhere) token goes to
    // sign-in instead of an error page; API requests answer 401 as before.
    const path = currentRequestPath();
    if (path && path.startsWith("/v2/")) redirect("/login");
    throw new Error("UNAUTHORIZED");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    // extraRoles is read on EVERY request rather than cached in the JWT, for the
    // same reason the role itself is: an admin revoking somebody's QA hat has to
    // take effect now, not at their next sign-in.
    select: {
      id: true,
      isActive: true,
      role: true,
      extraRoles: { select: { role: true } },
      twoFactorEnabled: true,
      twoStepRequiredSince: true,
    },
  });
  if (!user?.isActive) {
    throw new Error("UNAUTHORIZED");
  }
  // "Last seen": the genuine signed-in person (resolved BEFORE any "test as"
  // swap below, so an impersonated target is never marked as seen). Throttled
  // to one write per person per few minutes; never refuses the request.
  await recordLastSeen(user.id);

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

  // The genuine person's own requirement, before any "test as" swap below.
  await enforceTwoStepRequirement(user, held);

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

  await enforceOpsRequest(session.user);
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
  await recordLastSeen(user.id);
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
/**
 * A page render is redirected to an explanation; an API request throws so its
 * handler can answer 403. The path comes from middleware, never from the client.
 */
function denyRole(): never {
  let requestPath: string | null = null;
  try {
    requestPath = headers().get(REQUEST_PATH_HEADER);
  } catch {
    // Outside a request (scripts, tests): there is no page to redirect.
  }
  const destination = pageDenialDestination(requestPath);
  if (destination) redirect(destination);
  throw new Error("FORBIDDEN");
}

export async function requireRole(allowedRoles: Role[]) {
  const session = await requireSession();
  if (!canActAs(session.user.heldRoles ?? [session.user.role as Role], allowedRoles)) {
    denyRole();
  }
  // The gate admits anyone HOLDING an allowed role, but handlers scope records
  // by the role being ACTED AS ("if cleaner, only your jobs"). Someone holding
  // two roles could pass on one and be scoped as the other, which skipped the
  // ownership check entirely. On a route their active role is not allowed on,
  // they act as the held role the route does allow.
  session.user.role = resolveRouteRole(
    { role: session.user.role as Role, heldRoles: session.user.heldRoles },
    allowedRoles,
  );
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
    /** The recorded sign-in this session token carries (lib/auth/sign-in-records.ts); null for older tokens. */
    signInId?: string | null;
    impersonation?: {
      actorId: string;
      actorName?: string | null;
      actorEmail?: string | null;
      mode: "READ_ONLY" | "FULL";
      startedAt: number;
    };
  }
}
