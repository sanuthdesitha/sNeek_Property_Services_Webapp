/**
 * "FIND THE PEOPLE WHO HOLD THIS ROLE" — as a Prisma where-fragment.
 *
 * Since `UserRole` shipped, `User.role` is only somebody's PRIMARY hat. Any
 * query that still says `where: { role: Role.CLEANER }` is asking a question the
 * schema stopped answering: it means "whose MAIN job is cleaning", not "who can
 * clean". `lib/auth/roles.ts` fixed that for permission checks — the split there
 * is that "MAY I?" is answered against every HELD role. These are the DATA
 * queries, which that change did not reach.
 *
 * The two failure shapes are different and both are silent:
 *
 *   GATES  — `app/api/admin/jobs/[id]/assign` looks a user up with a scalar
 *            role match and rejects anyone it cannot find, with the message
 *            "Only active CLEANER users can be assigned". Somebody who holds
 *            CLEANER as a second role is told they are not a cleaner.
 *
 *   SWEEPS — payroll, dispatch candidates, day reminders and the recurring
 *            generator all build their working set from a scalar match, so a
 *            multi-role person is simply absent. Nothing errors. Payroll was
 *            the expensive one: no row, no pay.
 *
 * `lib/maintenance/assignments.ts` already solved this inline for the
 * maintenance rail. This is that same expression, named, so the cleaning rail
 * cannot drift away from it again.
 *
 * PURE — plain object literals, no Prisma import, no database.
 */

/** Prisma `UserWhereInput` fragment: holds `role`, primary or extra. */
export function holdsRoleWhere<T extends string>(role: T) {
  return {
    OR: [{ role }, { extraRoles: { some: { role } } }],
  };
}

/** Prisma `UserWhereInput` fragment: holds ANY of `roles`, primary or extra. */
export function holdsAnyRoleWhere<T extends string>(roles: readonly T[]) {
  return {
    OR: [{ role: { in: roles } }, { extraRoles: { some: { role: { in: roles } } } }],
  };
}

/**
 * Every role a loaded user holds — primary first, no duplicates.
 *
 * For a single-role account this is `[primary]`, so callers that bucket a person
 * by "every hat they wear" behave identically to before for the vast majority of
 * users. That equivalence is what makes this safe to apply broadly.
 */
export function heldRolesOf<T extends string>(user: {
  role: T;
  extraRoles?: readonly { role: T }[] | null;
}): T[] {
  const extra = (user.extraRoles ?? []).map((row) => row.role);
  return Array.from(new Set<T>([user.role, ...extra]));
}
