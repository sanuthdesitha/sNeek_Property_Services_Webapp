import { describe, it, expect, vi } from "vitest";

// Mock server-only since vitest runs outside Next.js server boundary
vi.mock("server-only", () => ({}));

// Mock the db module so route import doesn't try to spin up Prisma
vi.mock("@/lib/db", () => ({
  db: {
    notificationLog: { create: vi.fn() },
    user: { updateMany: vi.fn() },
  },
}));

describe("Resend webhook route", () => {
  it("module exports a POST handler", async () => {
    const mod = await import("@/app/api/integrations/resend/webhook/route");
    expect(typeof mod.POST).toBe("function");
  });
});
