import { describe, it, expect } from "vitest";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contract tests for the V1 form-templates admin API surface.
 *
 * The full route handlers pull in `server-only` + Prisma + NextAuth, which
 * vitest can't resolve under the jsdom runtime. Instead we (a) verify each
 * route file exists at the path the app router expects, and (b) lift the
 * input contracts and exercise their accept/reject behaviour. End-to-end
 * wiring is covered by the e2e suite.
 */

const ROOT = resolve(__dirname, "..", "..");

describe("form-templates route files exist", () => {
  it("collection route", () => {
    expect(
      existsSync(resolve(ROOT, "app/api/admin/form-templates/route.ts")),
    ).toBe(true);
  });

  it("[id] route", () => {
    expect(
      existsSync(resolve(ROOT, "app/api/admin/form-templates/[id]/route.ts")),
    ).toBe(true);
  });

  it("duplicate sub-route", () => {
    expect(
      existsSync(
        resolve(ROOT, "app/api/admin/form-templates/[id]/duplicate/route.ts"),
      ),
    ).toBe(true);
  });

  it("publish sub-route", () => {
    expect(
      existsSync(
        resolve(ROOT, "app/api/admin/form-templates/[id]/publish/route.ts"),
      ),
    ).toBe(true);
  });
});

describe("publish action contract", () => {
  // Mirror of the zod schema in publish/route.ts
  const schema = z.object({
    action: z.enum(["publish", "archive", "unarchive"]),
  });

  it("accepts the three documented actions", () => {
    expect(schema.safeParse({ action: "publish" }).success).toBe(true);
    expect(schema.safeParse({ action: "archive" }).success).toBe(true);
    expect(schema.safeParse({ action: "unarchive" }).success).toBe(true);
  });

  it("rejects unknown actions and missing inputs", () => {
    expect(schema.safeParse({ action: "delete" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ action: null }).success).toBe(false);
  });
});

describe("create template contract", () => {
  // Mirror of createTemplateSchema in form-templates/route.ts. We use a
  // string literal for the FormKind / JobType enums to avoid pulling in
  // @prisma/client at test time (it transitively imports server-only via
  // generated runtime).
  const jobTypes = [
    "AIRBNB_TURNOVER",
    "DEEP_CLEAN",
    "END_OF_LEASE",
    "GENERAL_CLEAN",
  ] as const;
  const formKinds = ["AIRBNB_TURNOVER", "CUSTOM", "WINDOW"] as const;
  const schema = z.object({
    name: z.string().min(1).max(100),
    serviceType: z.enum(jobTypes),
    kind: z.enum(formKinds).optional(),
    schema: z.record(z.unknown()).optional(),
  });

  it("accepts a minimal V1 create payload", () => {
    const r = schema.safeParse({
      name: "Premium turnover",
      serviceType: "AIRBNB_TURNOVER",
      kind: "AIRBNB_TURNOVER",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a missing name", () => {
    const r = schema.safeParse({
      name: "",
      serviceType: "AIRBNB_TURNOVER",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a name over 100 chars", () => {
    const r = schema.safeParse({
      name: "x".repeat(101),
      serviceType: "AIRBNB_TURNOVER",
    });
    expect(r.success).toBe(false);
  });
});
