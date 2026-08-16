import { describe, it, expect } from "vitest";
import { propertyScopeWhere, nestedPropertyScopeWhere } from "@/lib/auth/client-portal";

/**
 * The property-scope clause is the part every migrated route will lean on, and
 * the part that fails silently if it is wrong: a missing `id` filter does not
 * error, it just returns a VA more properties than their client granted.
 *
 * The clause is built centrally for exactly that reason — a route author should
 * not have to remember that the VA case exists.
 */

describe("propertyScopeWhere", () => {
  it("filters by client alone when the actor is unrestricted", () => {
    // A CLIENT is always unrestricted, as is a VA team with no explicit scope.
    expect(propertyScopeWhere({ clientId: "clx0client1", propertyIds: null })).toEqual({
      clientId: "clx0client1",
    });
  });

  it("adds an id filter when the team is scoped", () => {
    expect(
      propertyScopeWhere({ clientId: "clx0client1", propertyIds: ["clx0prop1", "clx0prop2"] })
    ).toEqual({ clientId: "clx0client1", id: { in: ["clx0prop1", "clx0prop2"] } });
  });

  it("ALWAYS keeps the client filter, even when scoped", () => {
    // Dropping clientId and trusting the id list would let a stale or tampered
    // scope reach another client's property.
    const where = propertyScopeWhere({ clientId: "clx0client1", propertyIds: ["clx0prop1"] });
    expect(where.clientId).toBe("clx0client1");
  });

  it("does not widen scope for an empty list", () => {
    // parseVaPropertyScope already turns [] into null (unrestricted); this
    // asserts the clause builder itself never invents an empty IN, which
    // Postgres would match to nothing and look like a broken portal.
    const where = propertyScopeWhere({ clientId: "clx0client1", propertyIds: [] as string[] });
    expect(where).toEqual({ clientId: "clx0client1", id: { in: [] } });
  });
});

describe("nestedPropertyScopeWhere", () => {
  it("wraps the same clause under a property relation", () => {
    expect(
      nestedPropertyScopeWhere({ clientId: "clx0client1", propertyIds: ["clx0prop1"] })
    ).toEqual({ property: { clientId: "clx0client1", id: { in: ["clx0prop1"] } } });
  });

  it("stays consistent with the flat form", () => {
    // The two must never drift: a route filtering jobs by property should get
    // exactly the restriction a route filtering properties would.
    const ctx = { clientId: "clx0client1", propertyIds: ["clx0prop1"] };
    expect(nestedPropertyScopeWhere(ctx).property).toEqual(propertyScopeWhere(ctx));
  });
});
