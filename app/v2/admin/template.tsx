import Link from "next/link";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { authOptions } from "@/lib/auth/auth-options";
import { REQUEST_PATH_HEADER } from "@/lib/auth/page-denial";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { twoStepRequirement } from "@/lib/auth/two-step-policy";
import { EToneNotice } from "@/components/v2/ui/tone-band";

/**
 * Two-step sign-in reminder for administrators during the grace period
 * (lib/auth/two-step-policy.ts). Shown on Command, where sign-in lands, as a
 * shell notice like the testing-as banner; never on other pages, and never a
 * dialog in the way. After the grace period the server sends admin pages to
 * Your profile instead (lib/auth/session.ts). Reads the genuine signed-in
 * person, not an account being tested as.
 */
async function TwoStepReminder() {
  let path: string | null = null;
  try {
    path = headers().get(REQUEST_PATH_HEADER);
  } catch {
    return null;
  }
  if (path !== "/v2/admin") return null;
  const session = await getServerSession(authOptions).catch(() => null);
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await db.user
    .findUnique({ where: { id: userId }, select: { role: true, twoFactorEnabled: true, twoStepRequiredSince: true, extraRoles: { select: { role: true } } } })
    .catch(() => null);
  if (!user) return null;
  const held = [user.role, ...user.extraRoles.map((row) => row.role)];
  const state = twoStepRequirement({
    holdsAdmin: held.includes(Role.ADMIN),
    holdsOpsManager: held.includes(Role.OPS_MANAGER),
    twoFactorEnabled: user.twoFactorEnabled,
    requiredSince: user.twoStepRequiredSince,
  });
  if (state.kind !== "grace") return null;
  const timeZone = (await getAppSettings().catch(() => null))?.timezone || "Australia/Sydney";
  const deadline = state.deadline ? formatInTimeZone(state.deadline, timeZone, "EEE d MMM") : null;
  return (
    <EToneNotice tone="attention" title="Two-step sign-in is required for administrators" className="mb-4" role="note">
      {deadline ? `Turn it on by ${deadline}; after that, admin pages open only once it is on. ` : "Turn it on within 14 days. "}
      <Link href="/v2/admin/profile?setup=two-step" className="font-[600] underline underline-offset-2">Set it up in Your profile</Link>
    </EToneNotice>
  );
}

export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TwoStepReminder />
      {children}
    </>
  );
}
