import { describe, it, expect } from "vitest";

describe("marketing campaign sender", () => {
  it("exports sendCampaign and dispatchDueCampaigns", async () => {
    const mod = await import("@/lib/marketing/campaign-sender");
    expect(typeof mod.sendCampaign).toBe("function");
    expect(typeof mod.dispatchDueCampaigns).toBe("function");
  });
});
