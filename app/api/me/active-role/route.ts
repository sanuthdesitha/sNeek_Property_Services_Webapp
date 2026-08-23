import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { ACTIVE_ROLE_COOKIE, activeRoleCookieOptions } from "@/lib/auth/active-role";
import {
  ROLE_LABELS,
  hasMultipleRoles,
  portalHomeForRole,
  switchableRoles,
} from "@/lib/auth/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * WHICH HAT THE SIGNED-IN PERSON IS WEARING.
 *
 * The v2 portal layouts are client components, so the shell cannot read
 * `session.user.heldRoles` off the server session the way a page can — hence a
 * GET. Nothing here is a grant: the list is computed from what the DATABASE
 * says the person holds (requireSession re-reads `extraRoles` on every request),
 * and the POST refuses anything not on it.
 */

interface SwitchOption {
  role: Role;
  label: string;
  home: string;
}

/**
 * The hats worth offering, in a stable order.
 *
 * THE PRIMARY IS ALWAYS FIRST AND ALWAYS PRESENT, even though it is absent from
 * `SWITCHABLE_ROLES` when it is ADMIN or OPS_MANAGER. Without it an admin who
 * also cleans, having switched to the cleaner portal, would be looking at a
 * switcher whose only entry is the hat they already have on — no way back to
 * the portal they came from short of editing the URL.
 *
 * Roles that own no portal are dropped: `portalHomeForRole` returning null means
 * there is nowhere to send them, so an entry would be a button that cannot act.
 */
function switchOptions(held: readonly Role[], primary: Role): SwitchOption[] {
  const options: SwitchOption[] = [];
  for (const role of [primary, ...switchableRoles(held)]) {
    if (options.some((option) => option.role === role)) continue;
    const home = portalHomeForRole(role);
    if (!home) continue;
    options.push({ role, label: ROLE_LABELS[role], home });
  }
  return options;
}

/** What the switcher renders. A single option means it renders nothing at all. */
export async function GET() {
  try {
    const session = await requireSession();
    const held = session.user.heldRoles ?? [session.user.role];
    const primary = session.user.primaryRole ?? session.user.role;

    const options = switchOptions(held, primary);
    return NextResponse.json({
      activeRole: session.user.role,
      primaryRole: primary,
      // Both conditions, not either: somebody could hold two roles of which only
      // one owns a portal, and a switcher with a single destination is a control
      // that cannot do anything.
      canSwitch: hasMultipleRoles(held) && options.length > 1,
      options,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Could not read your roles." },
      { status: statusFor(err?.message) }
    );
  }
}

/**
 * Put a different hat on.
 *
 * THE REQUESTED ROLE IS CHECKED AGAINST THE DATABASE, NOT THE BODY. The client
 * sends a role name and nothing else; `session.user.heldRoles` comes from a
 * fresh read of the user's primary role plus their `UserRole` rows, so a
 * hand-crafted POST naming a role somebody was never granted — or one an admin
 * revoked a second ago — is a 403 rather than a way in. The cookie this sets
 * carries no authority of its own for exactly the same reason.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const held = session.user.heldRoles ?? [session.user.role];
    const primary = session.user.primaryRole ?? session.user.role;

    const body = await req.json().catch(() => null);
    const requested = (body as { role?: unknown } | null)?.role;
    if (typeof requested !== "string" || !requested) {
      return NextResponse.json({ error: "Name the role to switch to." }, { status: 400 });
    }

    const option = switchOptions(held, primary).find((entry) => entry.role === requested);
    if (!option) {
      // 403 rather than 404: the role exists, this person is not it. Deliberately
      // the same answer whether they hold no such role or hold one with no
      // portal, so the response cannot be used to enumerate anyone's grants.
      return NextResponse.json({ error: "You do not hold that role." }, { status: 403 });
    }

    const res = NextResponse.json({ role: option.role, label: option.label, home: option.home });
    res.cookies.set(ACTIVE_ROLE_COOKIE, option.role, activeRoleCookieOptions());
    return res;
  } catch (err: any) {
    logger.error({ err }, "[active-role] could not switch the active role");
    return NextResponse.json(
      { error: err?.message ?? "Could not switch role." },
      { status: statusFor(err?.message) }
    );
  }
}

function statusFor(message: string | undefined): number {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN") return 403;
  return 400;
}
