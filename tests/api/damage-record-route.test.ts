// @vitest-environment node
/**
 * The damage report record page's route (PATCH/GET /api/admin/damage/[id]):
 * - live role guard on every call (ADMIN and OPS_MANAGER, as today);
 * - "Close without releasing" is the existing REVIEW with close and no release;
 * - release tells the client only with transports chosen explicitly, refuses
 *   before releasing when the message cannot be sent, never while testing as
 *   someone else, and a failed message never undoes the release;
 * - send back stays tier C (own PIN verified in the same request);
 * - an estimate is written only for an item of this report;
 * - "Preview as the client" answers the client view model.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  verify: vi.fn(),
  read: vi.fn(),
  record: vi.fn(),
  preview: vi.fn(),
  review: vi.fn(),
  cost: vi.fn(),
  voidReport: vi.fn(),
  assertSendable: vi.fn(),
  sendNotice: vi.fn(),
  previewNotice: vi.fn(),
  order: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/security/admin-verification", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/admin-verification")>("@/lib/security/admin-verification");
  return { ...actual, verifySensitiveAction: m.verify };
});
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/damage/investigation", () => ({ getDamageInvestigationForAdmin: m.read }));
vi.mock("@/lib/damage/record", () => ({ getDamageRecordForAdmin: m.record, getDamageClientPreview: m.preview }));
vi.mock("@/lib/damage/review", () => ({ setDamageItemCost: m.cost, reviewDamageReport: m.review }));
vi.mock("@/lib/damage/void", () => ({ voidDamageReport: m.voidReport }));
vi.mock("@/lib/damage/release-notice", async () => {
  const { z } = await import("zod");
  class DamageReleaseNoticeRefused extends Error {
    constructor(readonly status: number, message: string) { super(message); }
  }
  return {
    DamageReleaseNoticeRefused,
    damageReleaseNoticeSchema: z.object({ transports: z.array(z.enum(["INBOX", "EMAIL", "SMS"])).max(3), idempotencyKey: z.string().min(8) }).strict(),
    assertDamageReleaseNoticeSendable: m.assertSendable,
    sendDamageReleaseNotice: m.sendNotice,
    previewDamageReleaseNotice: m.previewNotice,
  };
});

import { GET, PATCH } from "@/app/api/admin/damage/[reportId]/route";
import { DamageReleaseNoticeRefused } from "@/lib/damage/release-notice";
import { SensitiveVerificationError } from "@/lib/security/admin-verification";

const admin = { user: { id: "admin", role: "ADMIN" } };
const testing = { user: { id: "target", role: "OPS_MANAGER" }, impersonation: { actorId: "admin" } };
const params = { params: { reportId: "report" } };
const patch = (body: unknown) => PATCH(new NextRequest("http://local/api/admin/damage/report", { method: "PATCH", body: JSON.stringify(body) }), params);
const get = (query = "") => GET(new NextRequest(`http://local/api/admin/damage/report${query}`), params);
const notice = { transports: ["INBOX", "EMAIL"], idempotencyKey: "release:abc12345" };

beforeEach(() => {
  vi.clearAllMocks();
  m.order.length = 0;
  m.role.mockResolvedValue(admin);
  m.verify.mockResolvedValue(true);
  m.read.mockResolvedValue({ id: "report" });
  m.record.mockResolvedValue({ report: { id: "report" }, context: { history: [] } });
  m.review.mockImplementation(async () => { m.order.push("review"); return { id: "report" }; });
  m.assertSendable.mockImplementation(async () => { m.order.push("check"); });
  m.sendNotice.mockImplementation(async () => { m.order.push("notice"); return { outcomes: [{ transport: "INBOX", state: "inbox_available" }], taken: true, replayed: false }; });
});

describe("authorization", () => {
  it("asks the live role guard for ADMIN or OPS_MANAGER on every read and write", async () => {
    await get();
    await patch({ action: "REVIEW", release: false });
    expect(m.role).toHaveBeenCalledTimes(2);
    for (const call of m.role.mock.calls) expect(call[0]).toEqual(["ADMIN", "OPS_MANAGER"]);
  });

  it("refuses anyone the guard refuses, before reading or writing anything", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await get()).status).toBe(403);
    expect((await get("?view=client")).status).toBe(403);
    expect((await patch({ action: "REVIEW", release: true, notice })).status).toBe(403);
    expect(m.record).not.toHaveBeenCalled();
    expect(m.preview).not.toHaveBeenCalled();
    expect(m.review).not.toHaveBeenCalled();
    expect(m.sendNotice).not.toHaveBeenCalled();
  });
});

describe("decisions", () => {
  it("closes without releasing through the existing review: no release, no message", async () => {
    const response = await patch({ action: "REVIEW", release: false, close: true, notice });
    expect(response.status).toBe(200);
    expect(m.review).toHaveBeenCalledWith({ reportId: "report", reviewerUserId: "admin", release: false, close: true });
    expect(m.assertSendable).not.toHaveBeenCalled();
    expect(m.sendNotice).not.toHaveBeenCalled();
  });

  it("releases silently when no transport is ticked", async () => {
    await patch({ action: "REVIEW", release: true, notice: { transports: [], idempotencyKey: "release:abc12345" } });
    expect(m.review).toHaveBeenCalledWith(expect.objectContaining({ release: true }));
    expect(m.sendNotice).not.toHaveBeenCalled();
  });

  it("checks the message, releases, then sends it with exactly the transports chosen", async () => {
    const response = await patch({ action: "REVIEW", release: true, notice });
    const body = await response.json();
    expect(m.order).toEqual(["check", "review", "notice"]);
    expect(m.sendNotice).toHaveBeenCalledWith({ actorId: "admin", reportId: "report", request: notice });
    expect(body.notice).toMatchObject({ taken: true });
  });

  it("refuses before releasing when the client cannot be told (notifications off)", async () => {
    m.assertSendable.mockRejectedValue(new DamageReleaseNoticeRefused(409, "This client has switched off notifications. Untick the message to release without telling them."));
    const response = await patch({ action: "REVIEW", release: true, notice });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("switched off notifications");
    expect(m.review).not.toHaveBeenCalled();
  });

  it("never sends a message while testing as someone else, and releases nothing", async () => {
    m.role.mockResolvedValue(testing);
    const response = await patch({ action: "REVIEW", release: true, notice });
    expect(response.status).toBe(403);
    expect(m.review).not.toHaveBeenCalled();
    expect(m.sendNotice).not.toHaveBeenCalled();
  });

  it("keeps the release when the message fails afterwards, and says nothing was sent", async () => {
    m.sendNotice.mockRejectedValue(new Error("pipeline down"));
    const response = await patch({ action: "REVIEW", release: true, notice });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(m.review).toHaveBeenCalled();
    expect(body.notice).toMatchObject({ taken: false, outcomes: [], error: expect.stringContaining("Nothing was sent") });
  });

  it("takes a report back through the same review with release false", async () => {
    await patch({ action: "REVIEW", release: false });
    expect(m.review).toHaveBeenCalledWith({ reportId: "report", reviewerUserId: "admin", release: false, close: undefined });
  });
});

describe("send back stays tier C", () => {
  it("verifies the person's own PIN in the same request before voiding", async () => {
    await patch({ action: "VOID", mode: "CLEAR_AND_REDO", reason: "Wrong item or room", security: { pin: "4826" } });
    expect(m.verify).toHaveBeenCalledWith("admin", { pin: "4826" });
    expect(m.voidReport).toHaveBeenCalledWith({ reportId: "report", actorUserId: "admin", mode: "CLEAR_AND_REDO", reason: "Wrong item or room" });
  });

  it("records nothing without a PIN", async () => {
    m.verify.mockRejectedValueOnce(new SensitiveVerificationError("PIN_OR_PASSWORD_REQUIRED"));
    const response = await patch({ action: "VOID", mode: "KEEP_AND_REOPEN", reason: "Duplicate report" });
    expect(response.status).toBe(423);
    expect(m.voidReport).not.toHaveBeenCalled();
  });
});

describe("estimates and previews", () => {
  it("writes an estimate only within this report and records who changed it", async () => {
    await patch({ action: "SET_COST", itemId: "item1", estimatedCost: null });
    expect(m.cost).toHaveBeenCalledWith({ itemId: "item1", estimatedCost: null, reportId: "report", actorUserId: "admin" });
  });

  it("answers Preview as the client from the client serializer, and the record with its context", async () => {
    m.preview.mockResolvedValue({ id: "report", items: [] });
    const preview = await (await get("?view=client")).json();
    expect(preview).toEqual({ report: { id: "report", items: [] }, audience: "CLIENT" });
    expect(m.record).not.toHaveBeenCalled();
    const record = await (await get()).json();
    expect(record).toEqual({ report: { id: "report" }, context: { history: [] } });
  });

  it("answers 404 for a report that does not exist", async () => {
    m.record.mockResolvedValue(null);
    m.preview.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect((await get("?view=client")).status).toBe(404);
  });
});
