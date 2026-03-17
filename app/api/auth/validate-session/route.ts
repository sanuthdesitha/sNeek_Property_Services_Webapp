import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/lib/db";
import { getUserExtendedProfile } from "@/lib/accounts/user-details";
import { getAuthUserState, getMissingRequiredProfileFields } from "@/lib/auth/account-state";

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
  });
}
