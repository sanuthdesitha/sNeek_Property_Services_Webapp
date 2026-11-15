// @vitest-environment node
/**
 * Social post generator routes (2026-11-17): the live session guard on every
 * route, the live right check on changes, posting refused while testing as
 * someone, connecting ADMIN-only with the person's own PIN verified in the
 * same request, no token or secret in any answer, and the public media link
 * serving only a stored cleaned copy of the post it names.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(), right: vi.fn(), publish: vi.fn(), view: vi.fn(), verify: vi.fn(), startConnect: vi.fn(), saveApp: vi.fn(),
  asset: vi.fn(), readDerivative: vi.fn(), listAccounts: vi.fn(), metaApp: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/marketing/social/access", () => ({ socialRightRefusal: m.right, testingAsRefusal: (session: { impersonation?: unknown }) => (session.impersonation ? "Stop testing as someone else to do this." : null) }));
vi.mock("@/lib/marketing/social/publish", async () => {
  const actual = await vi.importActual<typeof import("@/lib/marketing/social/publish")>("@/lib/marketing/social/publish");
  return { ...actual, publishGroup: m.publish };
});
vi.mock("@/lib/marketing/social/groups", async () => {
  const actual = await vi.importActual<typeof import("@/lib/marketing/social/groups")>("@/lib/marketing/social/groups");
  return { ...actual, loadGroupView: m.view };
});
vi.mock("@/lib/security/admin-verification", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/admin-verification")>("@/lib/security/admin-verification");
  return { ...actual, verifySensitiveAction: m.verify };
});
vi.mock("@/lib/marketing/social/accounts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/marketing/social/accounts")>("@/lib/marketing/social/accounts");
  return { ...actual, startMetaConnect: m.startConnect, saveMetaApp: m.saveApp, listAccounts: m.listAccounts, metaAppState: m.metaApp };
});
vi.mock("@/lib/db", () => ({ db: { marketingAsset: { findUnique: m.asset } } }));
vi.mock("@/lib/marketing/social/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/marketing/social/storage")>("@/lib/marketing/social/storage");
  return { ...actual, readDerivative: m.readDerivative };
});

import { POST as publishRoute } from "@/app/api/admin/marketing/social/groups/[id]/publish/route";
import { POST as connectRoute } from "@/app/api/admin/marketing/social/accounts/meta/connect/route";
import { POST as appRoute } from "@/app/api/admin/marketing/social/accounts/meta/app/route";
import { GET as accountsRoute } from "@/app/api/admin/marketing/social/accounts/route";
import { GET as publicMedia } from "@/app/api/public/social-media/[token]/route";
import { signMediaToken } from "@/lib/marketing/social/public-media";

const admin = { user: { id: "admin-1", role: "ADMIN" } };
const ops = { user: { id: "ops-1", role: "OPS_MANAGER" } };
const json = (body: unknown) => new NextRequest("https://app.example.test/api", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", "route-test-secret");
  m.requireRole.mockResolvedValue(admin);
  m.right.mockResolvedValue(null);
  m.view.mockResolvedValue({ id: "g1" });
  m.publish.mockResolvedValue([{ network: "FACEBOOK", outcome: "POSTED", message: "ok", externalUrl: null }]);
});

describe("posting", () => {
  it("runs the live session guard and the live right check, then publishes as the actual person", async () => {
    const response = await publishRoute(json({ networks: ["FACEBOOK"] }), { params: { id: "g1" } });
    expect(response.status).toBe(200);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    expect(m.right).toHaveBeenCalledWith("admin-1", "post");
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ groupId: "g1", actorId: "admin-1", trigger: "CLICK" }), expect.anything());
  });

  it("refuses an operations manager without Marketing at Manage, and anyone testing as someone else", async () => {
    m.requireRole.mockResolvedValue(ops);
    m.right.mockResolvedValue("This needs Marketing set to Manage in your access.");
    expect((await publishRoute(json({ networks: ["FACEBOOK"] }), { params: { id: "g1" } })).status).toBe(403);
    m.requireRole.mockResolvedValue({ ...admin, impersonation: { actorId: "admin-1" } });
    m.right.mockResolvedValue(null);
    const testing = await publishRoute(json({ networks: ["FACEBOOK"] }), { params: { id: "g1" } });
    expect(testing.status).toBe(403);
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("answers 401 for a signed-out request and never publishes", async () => {
    m.requireRole.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await publishRoute(json({ networks: ["FACEBOOK"] }), { params: { id: "g1" } })).status).toBe(401);
    expect(m.publish).not.toHaveBeenCalled();
  });
});

describe("connecting", () => {
  it("is ADMIN only and verifies the person's own PIN in the same request", async () => {
    m.startConnect.mockResolvedValue({ authUrl: "https://www.facebook.com/v24.0/dialog/oauth?state=x" });
    const response = await connectRoute(json({ security: { pin: "4826" } }));
    expect(response.status).toBe(200);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(m.verify).toHaveBeenCalledWith("admin-1", { pin: "4826" }, "social.connect");
  });

  it("a refused PIN changes nothing; testing as someone is refused before the PIN", async () => {
    const { SensitiveVerificationError } = await import("@/lib/security/admin-verification");
    m.verify.mockRejectedValue(new SensitiveVerificationError("INVALID_SECURITY_VERIFICATION"));
    expect((await appRoute(json({ appId: "123456", appSecret: "abcdefabcdefabcdef12", security: { pin: "0000" } }))).status).toBe(423);
    expect(m.saveApp).not.toHaveBeenCalled();
    m.requireRole.mockResolvedValue({ ...admin, impersonation: { actorId: "admin-1" } });
    expect((await connectRoute(json({ security: { pin: "4826" } }))).status).toBe(403);
    expect(m.startConnect).not.toHaveBeenCalled();
  });

  it("the accounts answer carries no token or secret", async () => {
    m.listAccounts.mockResolvedValue([{ id: "a1", network: "FACEBOOK", displayName: "Page", status: "CONNECTED", scopes: [] }]);
    m.metaApp.mockResolvedValue({ appId: "123456", hasSecret: true, updatedAt: null });
    const response = await accountsRoute(new NextRequest("https://app.example.test/api/admin/marketing/social/accounts"));
    const text = JSON.stringify(await response.json());
    expect(text).not.toMatch(/Ciphertext|enc:v1|appSecret"/);
    expect(text).toContain("\"hasSecret\":true");
  });
});

describe("the public media link", () => {
  it("serves only the stored cleaned copy of the post it names", async () => {
    m.asset.mockResolvedValue({ s3Key: "marketing/social/g1/00000000-0000-0000-0000-000000000000.jpg", derivativeKind: "social_crop", socialGroupId: "g1", exifStripped: true });
    m.readDerivative.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
    const token = signMediaToken({ assetId: "asset-1", groupId: "g1" });
    const response = await publicMedia(new NextRequest("https://app.example.test/x"), { params: { token } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-robots-tag")).toMatch(/noindex/);
  });

  it("is 404 for another post's copy, a non-derivative, an expired or forged token", async () => {
    m.asset.mockResolvedValue({ s3Key: "jobs/evidence.jpg", derivativeKind: null, socialGroupId: "g1", exifStripped: false });
    expect((await publicMedia(new NextRequest("https://x/"), { params: { token: signMediaToken({ assetId: "asset-1", groupId: "g1" }) } })).status).toBe(404);
    m.asset.mockResolvedValue({ s3Key: "marketing/social/g2/x.jpg", derivativeKind: "social_crop", socialGroupId: "g2", exifStripped: true });
    expect((await publicMedia(new NextRequest("https://x/"), { params: { token: signMediaToken({ assetId: "asset-1", groupId: "g1" }) } })).status).toBe(404);
    const expired = signMediaToken({ assetId: "asset-1", groupId: "g1", now: new Date(Date.now() - 2 * 3_600_000) });
    expect((await publicMedia(new NextRequest("https://x/"), { params: { token: expired } })).status).toBe(404);
    expect((await publicMedia(new NextRequest("https://x/"), { params: { token: "abc.def" } })).status).toBe(404);
    expect(m.readDerivative).not.toHaveBeenCalled();
  });
});
