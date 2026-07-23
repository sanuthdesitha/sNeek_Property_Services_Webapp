import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/lib/db";
import { getUserExtendedProfile } from "@/lib/accounts/user-details";
import { getAuthUserState, getMissingRequiredProfileFields } from "@/lib/auth/account-state";
import { resolveImpersonation } from "@/lib/auth/impersonation-server";
import { getDefaultPortalVersion } from "@/lib/portal-version-store";

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
    select: { id: true, isActive: true, role: true },
  });

  if (!user?.isActive) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

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
  const missingFields = getMissingRequiredProfileFields(user.role, extendedProfile);
  const requiresOnboarding = Boolean(
    authState?.requiresOnboarding &&
      (!authState.tutorialSeen || missingFields.length > 0)
  );

  return NextResponse.json({
    valid: true,
    role: user.role,
    requiresPasswordReset: authState?.requiresPasswordReset === true,
    requiresOnboarding,
    defaultPortalVersion,
  });
}
