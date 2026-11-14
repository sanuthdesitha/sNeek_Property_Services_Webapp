// @vitest-environment node
/**
 * One-click campaign unsubscribe: a signed token for one address and purpose
 * "marketing", recorded in the existing suppression list with a reason only
 * campaign senders read. Operational and security mail ignore it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rows: new Map<string, { email: string; reason: string }>(), userStatus: "OK" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: {
  emailSuppression: {
    findUnique: vi.fn(async ({ where }: { where: { email: string } }) => m.rows.get(where.email) ?? null),
    create: vi.fn(async ({ data }: { data: { email: string; reason: string } }) => { m.rows.set(data.email, data); return data; }),
    upsert: vi.fn(async ({ where, create, update }: { where: { email: string }; create: { email: string; reason: string }; update: { reason: string } }) => { m.rows.set(where.email, m.rows.has(where.email) ? { email: where.email, reason: update.reason } : create); }),
  },
  user: { findFirst: vi.fn(async () => ({ emailStatus: m.userStatus })), updateMany: vi.fn(async () => ({ count: 0 })) },
} }));

import { applyMarketingUnsubscribe, marketingUnsubscribeToken, marketingUnsubscribeUrl, verifyUnsubscribeToken } from "@/lib/email-design/unsubscribe";
import { isMarketingSuppressed, isSuppressed, suppress } from "@/lib/email/suppression";
import { GET, POST } from "@/app/api/public/unsubscribe/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  m.rows.clear();
  m.userStatus = "OK";
  vi.stubEnv("NEXTAUTH_SECRET", "fixture-secret-for-unsubscribe-tokens");
});
afterEach(() => vi.unstubAllEnvs());

describe("signed token", () => {
  it("round-trips one address and refuses a tampered or foreign token", () => {
    const token = marketingUnsubscribeToken("Client@Example.invalid")!;
    expect(verifyUnsubscribeToken(token)).toBe("client@example.invalid");
    const [payload, signature] = token.split(".");
    const other = marketingUnsubscribeToken("someone@example.invalid")!.split(".")[0];
    expect(verifyUnsubscribeToken(`${other}.${signature}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${payload}.x${signature.slice(1)}`)).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
    vi.stubEnv("NEXTAUTH_SECRET", "a-different-secret-entirely-123");
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("makes no link when no signing secret is configured (the footer then says to reply)", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "");
    expect(marketingUnsubscribeUrl("client@example.invalid", "https://app.example.invalid")).toBeNull();
  });
});

describe("recording the opt-out", () => {
  it("is marketing only: campaigns stop, operational email does not", async () => {
    const token = marketingUnsubscribeToken("client@example.invalid")!;
    expect(await applyMarketingUnsubscribe(token, "link")).toEqual({ ok: true, email: "client@example.invalid" });
    expect(m.rows.get("client@example.invalid")?.reason).toBe("MARKETING_OPT_OUT");
    expect(await isMarketingSuppressed("client@example.invalid")).toBe(true);
    expect(await isSuppressed("client@example.invalid")).toBe(false);
  });

  it("never weakens a stronger reason already on the list", async () => {
    await suppress("bounced@example.invalid", "HARD_BOUNCE");
    await applyMarketingUnsubscribe(marketingUnsubscribeToken("bounced@example.invalid")!, "one-click");
    expect(m.rows.get("bounced@example.invalid")?.reason).toBe("HARD_BOUNCE");
  });

  it("the public page asks before recording, and POST (button or one-click) records it", async () => {
    const token = marketingUnsubscribeToken("client@example.invalid")!;
    const page = await GET(new NextRequest(`http://localhost/api/public/unsubscribe?t=${encodeURIComponent(token)}`));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Unsubscribe from campaign emails?");
    expect(m.rows.size).toBe(0);
    const done = await POST(new NextRequest(`http://localhost/api/public/unsubscribe?t=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
    expect(done.status).toBe(200);
    expect(m.rows.get("client@example.invalid")?.reason).toBe("MARKETING_OPT_OUT");
    const bad = await POST(new NextRequest("http://localhost/api/public/unsubscribe?t=forged.token", { method: "POST" }));
    expect(bad.status).toBe(400);
  });
});
