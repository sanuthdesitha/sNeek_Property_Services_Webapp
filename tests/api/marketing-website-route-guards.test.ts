// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), reach: vi.fn(), retry: vi.fn(), usage: vi.fn(), blogFind: vi.fn(), blogDelete: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/marketing/campaign-reach", () => ({ computeCampaignReach: m.reach }));
vi.mock("@/lib/marketing/email-campaigns", () => ({ retryFailedEmailCampaign: m.retry }));
vi.mock("@/lib/marketing/image-usage", () => ({ findImageUsage: m.usage }));
vi.mock("@/lib/marketing/segments", () => ({ isSegmentId: (value: unknown) => value === "all_active_clients" }));
vi.mock("@/lib/db", () => ({ db: { blogPost: { findMany: m.blogFind, delete: m.blogDelete } } }));

import { POST as reach } from "@/app/api/admin/email-campaigns/reach/route";
import { POST as retry } from "@/app/api/admin/email-campaigns/[id]/retry/route";
import { GET as usage } from "@/app/api/admin/marketing/assets/[id]/usage/route";
import { GET as listPosts } from "@/app/api/admin/blog-posts/route";
import { DELETE as deletePost } from "@/app/api/admin/blog-posts/[id]/route";

const reachRequest = (audience: unknown) => new Request("http://localhost/api/admin/email-campaigns/reach", { method: "POST", body: JSON.stringify({ audience }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "u1", role: "OPS_MANAGER" } });
});

describe("live role guards on the new routes", () => {
  it("ADMIN and OPS_MANAGER keep today's rights: counts, retry and usage", async () => {
    m.reach.mockResolvedValue({ withEmail: 3, willSend: 2, unsubscribed: 1, bounceList: 0, noEmail: 1 });
    const res = await reach(reachRequest({ type: "segment", filters: { segmentId: "all_active_clients" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ reach: { withEmail: 3, willSend: 2, unsubscribed: 1, bounceList: 0, noEmail: 1 } });
    m.retry.mockResolvedValue({ sent: 1, failed: 0, suppressed: 0, retried: 1 });
    expect((await retry(new Request("http://localhost"), { params: { id: "c1" } })).status).toBe(200);
    m.usage.mockResolvedValue({ status: "known", uses: [] });
    expect((await usage(new Request("http://localhost"), { params: { id: "a1" } })).status).toBe(200);
    for (const call of m.role.mock.calls) expect(call[0]).toEqual(["ADMIN", "OPS_MANAGER"]);
  });

  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]])("refuses %s before doing anything", async (message, status) => {
    m.role.mockRejectedValue(new Error(message as string));
    expect((await reach(reachRequest({ type: "all_clients" }))).status).toBe(status);
    expect((await retry(new Request("http://localhost"), { params: { id: "c1" } })).status).toBe(status);
    expect((await usage(new Request("http://localhost"), { params: { id: "a1" } })).status).toBe(status);
    expect((await listPosts()).status).toBe(status);
    expect((await deletePost(new Request("http://localhost") as any, { params: { id: "p1" } })).status).toBe(status);
    expect(m.reach).not.toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
    expect(m.usage).not.toHaveBeenCalled();
    expect(m.blogFind).not.toHaveBeenCalled();
    expect(m.blogDelete).not.toHaveBeenCalled();
  });

  it("an invalid audience is refused without counting", async () => {
    expect((await reach(reachRequest({ type: "single_recipient" }))).status).toBe(400);
    expect(m.reach).not.toHaveBeenCalled();
  });
});
