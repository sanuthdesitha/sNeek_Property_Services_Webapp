import { Role } from "@prisma/client";

/**
 * ONE PERSON, MORE THAN ONE JOB.
 *
 * The business has people who clean and also inspect, or drive laundry and also
 * clean. Until now that meant two logins, or a role that described half of what
 * they do.
 *
 * THE PRIMARY ROLE DOES NOT MOVE. `User.role` still decides which portal
 * somebody lands in and is what every historical row was written against.
 * Additional roles are rows in `UserRole`. An account with none behaves exactly
 * as it did before this existed — which is the whole reason for the split, since
 * there are 848 authorisation call sites and none of them should have to change.
 *
 * TWO DIFFERENT QUESTIONS, and conflating them is the trap:
 *
 *   MAY I?      — authorisation. Answered against every role the person HOLDS.
 *                 Somebody who genuinely is a QA inspector is one whichever hat
 *                 they happen to be wearing; making an endpoint refuse them
 *                 until they flick a switch adds no safety — flicking it takes
 *                 one click — and breaks every cross-portal link.
 *
 *   WHERE AM I? — presentation. Answered against the ACTIVE role: which portal
 *                 to land in, which nav to show, which accent, where "home"
 *                 goes. This is the one the switcher changes.
 *
 * SELF-REVIEW IS NOT HANDLED HERE. Holding both CLEANER and QA_INSPECTOR is
 * legitimate; inspecting your own clean is not. That rule lives in
 * lib/qa/self-review.ts and guards the ACT, not the role — the conflict is
 * per-job, and no amount of role checking can see it.
 *
 * PURE — no database, no cookies.
 */

/**
 * Every role a person may act as: their primary, plus any extras.
 *
 * The primary is always first and always present, even if a stray `UserRole`
 * row duplicates it — a duplicate must not change the order or the length,
 * because callers read `[0]` as "their real job".
 */
export function heldRoles(primary: Role, extras: readonly Role[] = []): Role[] {
  const out: Role[] = [primary];
  for (const role of extras) {
    if (role !== primary && !out.includes(role)) out.push(role);
  }
  return out;
}

/** Does this person hold a role that satisfies the gate? */
export function canActAs(held: readonly Role[], allowed: readonly Role[]): boolean {
  return held.some((role) => allowed.includes(role));
}

/** Is this person more than one thing? Decides whether a switcher appears at all. */
export function hasMultipleRoles(held: readonly Role[]): boolean {
  return held.length > 1;
}

/**
 * Which role is this person currently acting as?
 *
 * A REQUESTED ROLE THEY NO LONGER HOLD FALLS BACK TO THE PRIMARY, silently and
 * on every request. That is the revocation path: an admin removing somebody's QA
 * role must take effect immediately, and a cookie asserting otherwise is a stale
 * claim rather than a grant. Never trust the cookie for WHAT somebody holds —
 * only for which of their held roles they picked.
 */
export function resolveActiveRole(
  held: readonly Role[],
  requested: string | null | undefined,
  primary: Role
): Role {
  if (!requested) return primary;
  const match = held.find((role) => role === requested);
  return match ?? primary;
}

/**
 * Roles that own a v2 portal of their own.
 *
 * ADMIN and OPS_MANAGER are absent deliberately: they already reach every
 * portal, so offering them a "switch to admin" control would be a no-op button.
 * VA is absent because it is not a portal role at all — a VA acts inside the
 * CLIENT portal through `requireClientPortal`, and listing it here would invite
 * exactly the `requireRole([Role.CLIENT, Role.VA])` mistake the Role enum's own
 * doc comment warns against.
 */
export const SWITCHABLE_ROLES: Role[] = [
  Role.CLEANER,
  Role.QA_INSPECTOR,
  Role.LAUNDRY,
  Role.MAINTENANCE,
];

/** The roles worth offering in a switcher, in a stable order. */
export function switchableRoles(held: readonly Role[]): Role[] {
  return SWITCHABLE_ROLES.filter((role) => held.includes(role));
}

/**
 * Roles an admin may GRANT as an extra.
 *
 * ADMIN and OPS_MANAGER are excluded: handing out administrative access as a
 * secondary hat is a privilege-escalation path, and promoting somebody to admin
 * should be a deliberate change to their primary role rather than a checkbox on
 * a list. CLIENT and VA are excluded because both are scoped to a client
 * account — a person is a particular client's assistant, not generically "a VA",
 * and `requireClientPortal` resolves that scope from the client link rather than
 * from the role.
 */
export const GRANTABLE_EXTRA_ROLES: Role[] = [
  Role.CLEANER,
  Role.QA_INSPECTOR,
  Role.LAUNDRY,
  Role.MAINTENANCE,
];

export function isGrantableExtraRole(role: Role): boolean {
  return GRANTABLE_EXTRA_ROLES.includes(role);
}

/** Human labels, so a switcher and an admin list cannot drift apart. */
export const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: "Admin",
  [Role.OPS_MANAGER]: "Ops manager",
  [Role.QA_INSPECTOR]: "QA inspector",
  [Role.CLEANER]: "Cleaner",
  [Role.CLIENT]: "Client",
  [Role.LAUNDRY]: "Laundry",
  [Role.MAINTENANCE]: "Maintenance",
  [Role.VA]: "Virtual assistant",
};

/** The v2 portal home for a role, or null when it owns no portal. */
export function portalHomeForRole(role: Role): string | null {
  switch (role) {
    case Role.CLEANER:
      return "/v2/cleaner";
    case Role.QA_INSPECTOR:
      return "/v2/qa";
    case Role.LAUNDRY:
      return "/v2/laundry";
    case Role.MAINTENANCE:
      return "/v2/maintenance";
    case Role.CLIENT:
    case Role.VA:
      return "/v2/client";
    case Role.ADMIN:
    case Role.OPS_MANAGER:
      return "/v2/admin";
    default:
      return null;
  }
}
