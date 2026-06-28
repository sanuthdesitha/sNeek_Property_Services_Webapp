import { describe, it, expect, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    emailCampaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => []),
    },
    client: { findMany: vi.fn(async () => []) },
  },
}));

const mockDb = db as unknown as {
  emailCampaign: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  client: { findMany: ReturnType<typeof vi.fn> };
};

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

  it("atomically claims SCHEDULED -> SENDING before sending", async () => {
    mockDb.emailCampaign.findMany.mockResolvedValueOnce([{ id: "c1" }]);
    mockDb.emailCampaign.updateMany.mockResolvedValueOnce({ count: 1 });
    mockDb.emailCampaign.findUnique.mockResolvedValueOnce({
      id: "c1",
      channel: "EMAIL",
      audience: { type: "all_clients" },
      template: null,
      htmlBody: "<p>hi</p>",
      subject: "Hi",
    });
    mockDb.client.findMany.mockResolvedValueOnce([]);

    const mod = await import("@/lib/marketing/campaign-sender");
    const res = await mod.dispatchDueCampaigns(new Date());

    expect(mockDb.emailCampaign.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", campaignStatus: "SCHEDULED" },
      data: { campaignStatus: "SENDING" },
    });
    expect(res.dispatched).toBe(1);
  });

  it("does NOT send when the claim is lost to another instance (count !== 1)", async () => {
    mockDb.emailCampaign.findMany.mockResolvedValueOnce([{ id: "c2" }]);
    // Another scheduler tick / instance already flipped it: our update matches 0 rows.
    mockDb.emailCampaign.updateMany.mockResolvedValueOnce({ count: 0 });
    mockDb.emailCampaign.findUnique.mockClear();

    const mod = await import("@/lib/marketing/campaign-sender");
    const res = await mod.dispatchDueCampaigns(new Date());

    // sendCampaign (which starts by loading the campaign) must never run.
    expect(mockDb.emailCampaign.findUnique).not.toHaveBeenCalled();
    expect(res.dispatched).toBe(0);
  });
});
