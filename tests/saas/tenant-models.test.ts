import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  GLOBAL_MODELS,
  TENANT_OWNED_MODELS,
  findRegistryGaps,
  isTenantOwned,
} from "@/lib/saas/tenant-models";

/**
 * Fail-closed guarantee: every Prisma model must be classified as either
 * GLOBAL or TENANT_OWNED. Adding a new model to schema.prisma without
 * classifying it here will fail this test — so a forgotten model can never
 * silently become a cross-tenant data leak.
 */
describe("tenant-model registry", () => {
  const modelNames = Prisma.dmmf.datamodel.models.map((m) => m.name);

  it("classifies every Prisma model exactly once", () => {
    const gaps = findRegistryGaps(modelNames);
    expect(gaps.unclassified, `unclassified models: ${gaps.unclassified.join(", ")}`).toEqual([]);
    expect(gaps.overlapping, `models in BOTH sets: ${gaps.overlapping.join(", ")}`).toEqual([]);
    expect(
      gaps.unknownInRegistry,
      `registry names not in schema: ${gaps.unknownInRegistry.join(", ")}`
    ).toEqual([]);
  });

  it("never scopes auth/platform tables", () => {
    for (const m of ["User", "Account", "Session", "Organization", "Plan", "Subscription"]) {
      expect(GLOBAL_MODELS.has(m)).toBe(true);
      expect(isTenantOwned(m)).toBe(false);
    }
  });

  it("scopes core business tables", () => {
    for (const m of ["Job", "Client", "Property", "Quote", "ClientInvoice", "Report"]) {
      expect(TENANT_OWNED_MODELS.has(m)).toBe(true);
      expect(isTenantOwned(m)).toBe(true);
    }
  });
});
