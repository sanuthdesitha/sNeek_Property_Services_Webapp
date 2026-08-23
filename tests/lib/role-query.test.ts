import { describe, it, expect } from "vitest";
import { heldRolesOf, holdsAnyRoleWhere, holdsRoleWhere } from "@/lib/auth/role-query";

/**
 * `User.role` is only the PRIMARY hat since UserRole shipped. A scalar
 * `where: { role: "CLEANER" }` therefore asks "whose main job is cleaning",
 * not "who can clean" — which rejected multi-role people from job assignment
 * and dropped them out of payroll entirely.
 */
describe("holdsRoleWhere", () => {
  it("matches the primary role OR an extra role", () => {
    expect(holdsRoleWhere("CLEANER")).toEqual({
      OR: [{ role: "CLEANER" }, { extraRoles: { some: { role: "CLEANER" } } }],
    });
  });

  it("is composable with other where clauses by spreading", () => {
    // How every call site uses it: `{ isActive: true, ...holdsRoleWhere(r) }`.
    // Spreading keeps `OR` at the top level, where Prisma ANDs it with the
    // sibling scalar filters — nesting it would change the meaning.
    const where = { isActive: true, ...holdsRoleWhere("QA_INSPECTOR") };
    expect(where).toEqual({
      isActive: true,
      OR: [{ role: "QA_INSPECTOR" }, { extraRoles: { some: { role: "QA_INSPECTOR" } } }],
    });
  });

  it("builds an independent object each call", () => {
    // Two call sites must never share a mutable literal.
    const a = holdsRoleWhere("CLEANER");
    const b = holdsRoleWhere("CLEANER");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("holdsAnyRoleWhere", () => {
  it("matches any of the roles, primary or extra", () => {
    expect(holdsAnyRoleWhere(["CLEANER", "QA_INSPECTOR"])).toEqual({
      OR: [
        { role: { in: ["CLEANER", "QA_INSPECTOR"] } },
        { extraRoles: { some: { role: { in: ["CLEANER", "QA_INSPECTOR"] } } } },
      ],
    });
  });

  it("survives an empty list without matching everybody", () => {
    // `{ in: [] }` matches nothing in Prisma, which is the safe reading of
    // "nobody holds any of these roles" — the dangerous bug would be an empty
    // filter that silently selects every user.
    const where = holdsAnyRoleWhere([]);
    expect(where.OR[0]).toEqual({ role: { in: [] } });
  });
});

describe("heldRolesOf", () => {
  it("returns just the primary for a single-role account", () => {
    // This equivalence is what makes the change safe to apply everywhere: for
    // the vast majority of users nothing about the result changes.
    expect(heldRolesOf({ role: "CLEANER" })).toEqual(["CLEANER"]);
    expect(heldRolesOf({ role: "CLEANER", extraRoles: [] })).toEqual(["CLEANER"]);
    expect(heldRolesOf({ role: "CLEANER", extraRoles: null })).toEqual(["CLEANER"]);
  });

  it("puts the primary first, then the extras", () => {
    expect(
      heldRolesOf({ role: "QA_INSPECTOR", extraRoles: [{ role: "CLEANER" }] })
    ).toEqual(["QA_INSPECTOR", "CLEANER"]);
  });

  it("does not repeat a role held both ways", () => {
    // The grant screen should prevent this, but a duplicate must not produce a
    // person listed twice under the same hat.
    expect(
      heldRolesOf({ role: "CLEANER", extraRoles: [{ role: "CLEANER" }, { role: "QA_INSPECTOR" }] })
    ).toEqual(["CLEANER", "QA_INSPECTOR"]);
  });
});
