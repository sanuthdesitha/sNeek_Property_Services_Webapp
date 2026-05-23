import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * Smoke tests for the cleaner ping endpoint's input contract. The full route
 * handler is server-only (touches Prisma and NextAuth), so we lift the schema
 * here and verify accept/reject behaviour for the shape and the 50-ping batch
 * cap. Wiring tests for the actual handler live in the e2e suite.
 */

const pingSchema = z.object({
  jobId: z.string(),
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().optional(),
  heading: z.number().optional(),
  speed: z.number().optional(),
  timestamp: z.string().datetime().optional(),
});

const bodySchema = z.union([pingSchema, z.array(pingSchema).max(50)]);

describe("cleaner ping schema", () => {
  it("accepts a single ping", () => {
    const r = bodySchema.safeParse({
      jobId: "job_123",
      lat: -33.8688,
      lng: 151.2093,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a batch of pings with optional fields", () => {
    const r = bodySchema.safeParse([
      { jobId: "a", lat: 0, lng: 0 },
      { jobId: "a", lat: 1, lng: 1, accuracy: 5, heading: 90, speed: 3 },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects a batch above the 50-ping cap", () => {
    const tooMany = Array.from({ length: 51 }, () => ({ jobId: "a", lat: 0, lng: 0 }));
    const r = bodySchema.safeParse(tooMany);
    expect(r.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const r = bodySchema.safeParse({ jobId: "a" });
    expect(r.success).toBe(false);
  });

  it("rejects non-ISO timestamp", () => {
    const r = bodySchema.safeParse({
      jobId: "a",
      lat: 0,
      lng: 0,
      timestamp: "not-a-date",
    });
    expect(r.success).toBe(false);
  });
});
