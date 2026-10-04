import { Role } from "@prisma/client";

/** Resolve the role actually admitted by a route before applying object scope.
 * An unrelated active portal must never bypass a cleaner/client ownership guard.
 * Keep the active role when admitted; otherwise use a held, admitted role.
 * This does not change the user's portal or the global requireRole contract.
 */
export function resolveRouteRole(
  user: { role: Role; heldRoles?: readonly Role[] },
  allowed: readonly Role[]
): Role {
  const held = user.heldRoles ?? [user.role];
  if (held.includes(user.role) && allowed.includes(user.role)) return user.role;
  const admitted = allowed.find((role) => held.includes(role));
  if (!admitted) throw new Error("FORBIDDEN");
  return admitted;
}
