import { expect, it } from "vitest";
import { Role } from "@prisma/client";
import { resolveRouteRole } from "@/lib/auth/route-role";
it("preserves an admitted active role without escalating to another held role", () => {
  expect(resolveRouteRole({ role: Role.CLEANER, heldRoles: [Role.QA_INSPECTOR, Role.CLEANER] }, [Role.QA_INSPECTOR, Role.CLEANER])).toBe(Role.CLEANER);
});
it("uses only held and admitted roles when current portal is irrelevant", () => {
  expect(resolveRouteRole({ role: Role.MAINTENANCE, heldRoles: [Role.CLEANER, Role.MAINTENANCE] }, [Role.ADMIN, Role.CLEANER])).toBe(Role.CLEANER);
});
it("does not trust an active role absent from current grants", () => {
  expect(resolveRouteRole({ role: Role.ADMIN, heldRoles: [Role.CLEANER] }, [Role.ADMIN, Role.CLEANER])).toBe(Role.CLEANER);
});
it("supports single-role sessions", () => {
  expect(resolveRouteRole({ role: Role.ADMIN }, [Role.ADMIN])).toBe(Role.ADMIN);
});
it("fails closed without any admitted grant", () => {
  expect(() => resolveRouteRole({ role: Role.MAINTENANCE }, [Role.CLEANER])).toThrow("FORBIDDEN");
});
