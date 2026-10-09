import { getOpsAccess } from "@/lib/rbac/ops-access";
import { NextRequest, NextResponse } from "next/server";
import { resolveRetainedAccount } from "@/lib/auth/retained-accounts";
import { RETAINED_BROWSER_COOKIE, retainedSecretCookie } from "@/lib/auth/retained-context";
import { getAuthUserState, getMissingRequiredProfileFields } from "@/lib/auth/account-state";
import { getUserExtendedProfile } from "@/lib/accounts/user-details";
import { getDefaultPortalVersion } from "@/lib/portal-version-store";
export async function GET(req: NextRequest) {
  try {
    const contextId = req.nextUrl.searchParams.get("context") ?? "";
    const session = await resolveRetainedAccount({ contextId, browserSecret: req.cookies.get(RETAINED_BROWSER_COOKIE)?.value ?? "", contextSecret: req.cookies.get(retainedSecretCookie(contextId))?.value ?? "" });
    const [state, profile, defaultPortalVersion] = await Promise.all([getAuthUserState(session.user.id), getUserExtendedProfile(session.user.id), getDefaultPortalVersion()]);
    return NextResponse.json({ valid: true, opsAccess: await getOpsAccess(session.user), id: session.user.id, role: session.user.role, heldRoles: session.user.heldRoles, defaultPortalVersion,
      requiresPasswordReset: state?.requiresPasswordReset === true,
      requiresOnboarding: Boolean(state?.requiresOnboarding && (!state.tutorialSeen || getMissingRequiredProfileFields(session.user.role, profile).length)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ valid: false }, { status: 401, headers: { "Cache-Control": "no-store" } }); }
}
