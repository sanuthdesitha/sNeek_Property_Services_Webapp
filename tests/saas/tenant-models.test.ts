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

  it("every TENANT_OWNED model actually has an organizationId column", () => {
    // Guards against drift between the registry and the schema rollout: if a
    // model is scoped but lacks the column, the fail-closed middleware would
    // throw on every query against it.
    const missing: string[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      if (!TENANT_OWNED_MODELS.has(model.name)) continue;
      if (!model.fields.some((f) => f.name === "organizationId")) {
        missing.push(model.name);
      }
    }
    expect(missing, `TENANT_OWNED models without an organizationId column: ${missing.join(", ")}`).toEqual([]);
  });
});
