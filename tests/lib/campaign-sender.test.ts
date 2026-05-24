import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    emailCampaign: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(async () => []) },
    client: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/notifications/email", () => ({
  sendEmailDetailed: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/notifications/sms", () => ({
  sendSmsDetailed: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/email/suppression", () => ({
  isSuppressed: vi.fn(async () => false),
}));

vi.mock("@/lib/messages/variables", () => ({
  resolveTemplate: vi.fn(async (s: string) => s),
}));

describe("marketing campaign sender", () => {
  it("exports sendCampaign and dispatchDueCampaigns", async () => {
    const mod = await import("@/lib/marketing/campaign-sender");
    expect(typeof mod.sendCampaign).toBe("function");
    expect(typeof mod.dispatchDueCampaigns).toBe("function");
  });

  it("dispatchDueCampaigns returns zero when nothing scheduled", async () => {
    const mod = await import("@/lib/marketing/campaign-sender");
    const res = await mod.dispatchDueCampaigns(new Date());
    expect(res.dispatched).toBe(0);
    expect(Array.isArray(res.results)).toBe(true);
  });
});
