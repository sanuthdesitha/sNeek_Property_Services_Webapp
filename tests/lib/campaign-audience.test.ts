import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { normalizeCampaignAudience, resolveSingleCampaignRecipient } from "@/lib/marketing/campaign-audience";
import { resolveEmailCampaignRecipients } from "@/lib/marketing/email-campaigns";

vi.mock("@/lib/db", () => ({ db: { client: { findMany: vi.fn() } } }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));

describe("single campaign audience", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    { type: "single_recipient" },
    { type: "single_recipient", filters: { email: "bad" } },
    { type: "single_recipient", filters: { email: "a@example.com,b@example.com" } },
    { type: "unknown" },
  ])("rejects invalid explicit selection without querying all clients: %j", async audience => {
    await expect(resolveEmailCampaignRecipients(audience)).rejects.toThrow();
    expect(db.client.findMany).not.toHaveBeenCalled();
  });
  it("preserves the default only for absent legacy audiences", () => {
    expect(normalizeCampaignAudience(null)).toEqual({ type: "all_clients" });
    expect(() => normalizeCampaignAudience({})).toThrow();
  });
  it("targets the exact secondary contact and its phone, not the primary email", async () => {
    vi.mocked(db.client.findMany).mockResolvedValue([{ id: "client1", name: "Client One", email: "primary@example.com", phone: "111", users: [{ phone: "222" }] }] as any);
    const result = await resolveEmailCampaignRecipients({ type: "single_recipient", filters: { email: " Second@Example.com " } });
    expect(result.count).toBe(1);
    expect(result.recipients).toEqual([{ clientId: "client1", clientName: "Client One", email: "second@example.com", phone: "222" }]);
    expect(db.client.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true, OR: [
      { email: { equals: "second@example.com", mode: "insensitive" } },
      { users: { some: { isActive: true, email: { equals: "second@example.com", mode: "insensitive" } } } },
    ] }, take: 2 }));
  });
  it("returns zero for an unmatched address without broadening the selection", async () => {
    vi.mocked(db.client.findMany).mockResolvedValue([]);
    expect(await resolveSingleCampaignRecipient("nobody@example.com")).toEqual([]);
    expect(db.client.findMany).toHaveBeenCalledTimes(1);
  });
  it("rejects ambiguous ownership rather than selecting an arbitrary client", async () => {
    vi.mocked(db.client.findMany).mockResolvedValue([{ id: "one" }, { id: "two" }] as any);
    await expect(resolveSingleCampaignRecipient("shared@example.com")).rejects.toThrow("more than one client");
  });
});
