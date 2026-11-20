// @vitest-environment node
/**
 * Lost and found guest link routes (2026-11-20), with the database mocked:
 * a wrong token answers 404 with one sentence and no item data; a revoked link
 * 410; the guest email carries the item's photo through the token and the
 * "View your item and request its return" button (never a storage key); the
 * public photo route serves only the token's own item; the office decision
 * route refuses an operations manager without the Lost & found pack and
 * anyone while impersonating.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "lost-found-routes-test-secret-0123456789";
  process.env.APP_URL = "https://app.example.test";
  return {
    resolve: vi.fn(),
    view: vi.fn(),
    requireRole: vi.fn(),
    ops: vi.fn(),
    approve: vi.fn(),
    sign: vi.fn(async (key: string) => `https://signed.example.test/${key}?sig=1`),
  };
});

vi.mock("@/lib/lost-found/guest-link", async (importOriginal) => ({ ...(await importOriginal<object>()), resolveGuestLink: m.resolve }));
vi.mock("@/lib/lost-found/return-requests", async (importOriginal) => ({ ...(await importOriginal<object>()), guestPageView: m.view }));
vi.mock("@/lib/lost-found/return-decisions", async (importOriginal) => ({ ...(await importOriginal<object>()), approveReturnRequest: m.approve }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops, getOpsPolicy: async () => ({ revision: 0, presets: [], assignments: {} }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", companyName: "sNeek", companyPhone: "" }) }));
vi.mock("@/lib/s3", () => ({ resolveS3: async () => ({ bucket: "b" }), getPresignedDownloadUrl: m.sign, publicUrl: (key: string) => `https://files.invalid/${key}` }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET as pageGet, POST as pagePost } from "@/app/api/public/lost-found/[token]/route";
import { GET as photoGet } from "@/app/api/public/lost-found/[token]/photo/route";
import { POST as decisionPost } from "@/app/api/admin/lost-found/[id]/return-requests/[requestId]/route";
import { buildGuestItemEmail } from "@/lib/lost-found/guest-email";

const TOKEN = "T".repeat(43);
const openItem = { id: "item-1", photos: [{ key: "lost-found/u/a.jpg", url: "https://files.invalid/lost-found/u/a.jpg" }, { key: "lost-found/u/b.jpg", url: "https://files.invalid/b.jpg" }] };

function req(url: string, init?: RequestInit) {
  return new NextRequest(url, init as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guest page route", () => {
  it("answers a wrong token with 404 and no item data", async () => {
    m.resolve.mockResolvedValue({ state: "invalid" });
    const response = await pageGet(req(`https://app.example.test/api/public/lost-found/${TOKEN}`), { params: { token: TOKEN } });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["error", "state"]);
    expect(m.view).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers a revoked or expired link with 410 and refuses a submit", async () => {
    m.resolve.mockResolvedValue({ state: "revoked" });
    expect((await pageGet(req(`https://app.example.test/x`), { params: { token: TOKEN } })).status).toBe(410);
    m.resolve.mockResolvedValue({ state: "expired" });
    const post = await pagePost(req("https://app.example.test/x", { method: "POST", body: JSON.stringify({ action: "submit" }) }), { params: { token: TOKEN } });
    expect(post.status).toBe(410);
  });

  it("validates a submit on the server (no confirmation tick, no contact)", async () => {
    m.resolve.mockResolvedValue({ state: "open", link: { id: "l1" }, item: openItem, token: TOKEN });
    const post = await pagePost(req("https://app.example.test/x", { method: "POST", body: JSON.stringify({ action: "submit", submissionKey: "key-12345678", method: "POST", contactName: "Gina", understood: false }) }), { params: { token: TOKEN } });
    expect(post.status).toBe(400);
  });
});

describe("guest photo route", () => {
  it("serves the token's own photo by position, never a key, and 404s past the end or for a bad link", async () => {
    m.resolve.mockResolvedValue({ state: "open", link: { id: "l1" }, item: openItem, token: TOKEN });
    const first = await photoGet(req(`https://app.example.test/api/public/lost-found/${TOKEN}/photo`), { params: { token: TOKEN } });
    expect(first.status).toBe(302);
    expect(m.sign).toHaveBeenLastCalledWith("lost-found/u/a.jpg", 600);
    const second = await photoGet(req(`https://app.example.test/api/public/lost-found/${TOKEN}/photo?n=1`), { params: { token: TOKEN } });
    expect(m.sign).toHaveBeenLastCalledWith("lost-found/u/b.jpg", 600);
    expect(second.status).toBe(302);
    expect((await photoGet(req(`https://app.example.test/x?n=2`), { params: { token: TOKEN } })).status).toBe(404);
    expect((await photoGet(req(`https://app.example.test/x?key=jobs/other.jpg`), { params: { token: TOKEN } })).status).toBe(302);
    expect(m.sign).toHaveBeenLastCalledWith("lost-found/u/a.jpg", 600);
    m.resolve.mockResolvedValue({ state: "invalid" });
    expect((await photoGet(req(`https://app.example.test/x`), { params: { token: TOKEN } })).status).toBe(404);
  });
});

describe("guest email", () => {
  it("carries the photo through the token and the link button; plain text without a link", async () => {
    const email = await buildGuestItemEmail({ subject: "Item found", body: "Hi Gina, we found your charger.", token: TOKEN, linkUrl: `https://app.example.test/lost-found/${TOKEN}`, hasPhoto: true });
    expect(email.html).toContain(`https://app.example.test/api/public/lost-found/${TOKEN}/photo`);
    expect(email.html).toContain(`https://app.example.test/lost-found/${TOKEN}`);
    expect(email.html).toContain("View your item and request its return");
    expect(email.html).toContain("we found your charger");
    expect(email.html).not.toContain("lost-found/u/a.jpg");
    const noPhoto = await buildGuestItemEmail({ subject: "Item found", body: "Hi", token: TOKEN, linkUrl: `https://app.example.test/lost-found/${TOKEN}`, hasPhoto: false });
    expect(noPhoto.html).not.toContain("/photo");
    const plain = await buildGuestItemEmail({ subject: "Item found", body: "Hi there", token: null, linkUrl: null, hasPhoto: true });
    expect(plain.html).not.toContain("View your item and request its return");
  });
});

describe("office decision route", () => {
  const body = JSON.stringify({ action: "approve", version: 1, decisionKey: "dec-12345678" });

  it("refuses an operations manager without the Lost & found pack at manage", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } });
    m.ops.mockResolvedValue({ "lost-found": "read" });
    const response = await decisionPost(req("https://app.example.test/x", { method: "POST", body }), { params: { id: "item-1", requestId: "r1" } });
    expect(response.status).toBe(403);
    expect(m.approve).not.toHaveBeenCalled();
  });

  it("refuses everyone while impersonating, administrators included", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "admin", role: "ADMIN", heldRoles: ["ADMIN"] }, impersonation: { actorId: "real" } });
    const response = await decisionPost(req("https://app.example.test/x", { method: "POST", body }), { params: { id: "item-1", requestId: "r1" } });
    expect(response.status).toBe(403);
    expect(m.approve).not.toHaveBeenCalled();
  });

  it("lets an administrator decide (ADMIN never depends on a pack)", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "admin", role: "ADMIN", heldRoles: ["ADMIN"], name: "Ada" } });
    m.approve.mockResolvedValue({ request: null, replayed: false, guestMessage: null, cleanerNotice: [] });
    const response = await decisionPost(req("https://app.example.test/x", { method: "POST", body }), { params: { id: "item-1", requestId: "r1" } });
    expect(response.status).toBe(200);
    expect(m.approve).toHaveBeenCalledWith("item-1", "r1", expect.objectContaining({ action: "approve" }), { id: "admin", role: "ADMIN", name: "Ada" }, { allowed: true, reason: null });
    expect(m.ops).not.toHaveBeenCalled();
  });
});
