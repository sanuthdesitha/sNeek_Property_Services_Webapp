import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/lib/db";
import { getUserExtendedProfile } from "@/lib/accounts/user-details";
import { getAuthUserState, getMissingRequiredProfileFields } from "@/lib/auth/account-state";
import { resolveImpersonation } from "@/lib/auth/impersonation-server";
import { getDefaultPortalVersion } from "@/lib/portal-version-store";
import { heldRoles, resolveActiveRole } from "@/lib/auth/roles";
import { ACTIVE_ROLE_COOKIE } from "@/lib/auth/active-role";

export async function GET(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token?.id || typeof token.id !== "string") {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: token.id },
    select: {
      id: true,
      isActive: true,
      role: true,
      extraRoles: { select: { role: true } },
    },
  });

  if (!user?.isActive) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  // MULTI-ROLE MUST RESOLVE IDENTICALLY HERE AND IN requireSession. Middleware
  // routes on what this returns; pages authorise on what requireSession
  // computes. If the two disagree, middleware sends somebody to the portal for
  // one role and the page there refuses them for another — a redirect loop, and
  // a total outage rather than a subtle bug.
  //
  // The cookie is read off the request rather than via next/headers, because
  // this handler already has it and the two must not diverge in how they parse.
  const held = heldRoles(
    user.role,
    user.extraRoles.map((row) => row.role)
  );
  const activeRole = resolveActiveRole(
    held,
    request.cookies.get(ACTIVE_ROLE_COOKIE)?.value?.trim() || null,
    user.role
  );

  // Admin "test as": middleware routes on whatever role this returns, so an
  // impersonated session must report the TARGET's role — otherwise the admin
  // is bounced straight back to /v2/admin by the portal gate. The onboarding
  // and password-reset prompts are suppressed: those belong to the real user's
  // account, and forcing an admin through a cleaner's onboarding wizard would
  // both be wrong and write to that cleaner's record.

  // Which look (v1 classic / v2 Estate) is the house default. Middleware runs
  // on the edge and cannot touch Prisma, so it rides along on the call
  // middleware already makes for every authenticated navigation rather than
  // costing a second round trip.
  const defaultPortalVersion = await getDefaultPortalVersion();

  const impersonation = await resolveImpersonation(user.id);
  if (impersonation) {
    return NextResponse.json({
      valid: true,
      role: impersonation.target.role,
      // The target's roles only. An admin viewing as a cleaner must not keep
      // their own reach, and middleware gates portals on this list.
      heldRoles: [impersonation.target.role],
      requiresPasswordReset: false,
      requiresOnboarding: false,
      impersonating: true,
      defaultPortalVersion,
    });
  }

  const [authState, extendedProfile] = await Promise.all([
    getAuthUserState(user.id),
    getUserExtendedProfile(user.id),
  ]);
  // PRIMARY role, not the active one: onboarding belongs to somebody's real
  // job, and a cleaner who also inspects should not be walked through QA
  // onboarding because they switched hats this morning.
  const missingFields = getMissingRequiredProfileFields(user.role, extendedProfile);
  const requiresOnboarding = Boolean(
    authState?.requiresOnboarding &&
      (!authState.tutorialSeen || missingFields.length > 0)
  );

  return NextResponse.json({
    valid: true,
    role: activeRole,
    heldRoles: held,
    requiresPasswordReset: authState?.requiresPasswordReset === true,
    requiresOnboarding,
    defaultPortalVersion,
  });
}
