// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { GET as getHistory, PATCH, DELETE } from "@/app/api/notifications/log/route";

const GET = (request = new Request("http://localhost/api/notifications/log")) => getHistory(request);

const mocks = vi.hoisted(() => ({ session: vi.fn(), rows: vi.fn(), update: vi.fn(), version: vi.fn(), cookie: vi.fn(), states: vi.fn() }));
vi.mock("@/lib/notifications/inbox-state-store", () => ({ readInboxStates: mocks.states }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/db", () => ({ db: { notification: { findMany: mocks.rows, updateMany: mocks.update } } }));
vi.mock("@/lib/portal-version-store", () => ({ getDefaultPortalVersion: mocks.version }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: mocks.cookie }) }));

const row = {
  id: "notification-1", userId: "recipient-1", jobId: "job-1", channel: "PUSH",
  subject: "Job update", body: "Your job was updated.", status: "SENT",
  createdAt: new Date("2026-09-09T00:00:00Z"), sentAt: null,
  errorMsg: "private provider detail", externalId: "provider-secret",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "recipient-1", role: Role.CLEANER } });
  mocks.rows.mockResolvedValue([row]);
  mocks.version.mockResolvedValue("v2");
});

describe("private notification history", () => {
  it.each([Role.ADMIN, Role.CLIENT])("denies impersonated %s deletion before storage", async role => {
    mocks.session.mockResolvedValue({ user: { id: "recipient-1", role }, impersonation: { actorId: "admin", mode: "INTERACTIVE" } });
    const result = await DELETE(); expect(result.status).toBe(403); expect(result.headers.get("cache-control")).toBe("private, no-store");
  });
  it("joins lifecycle only for visible current-recipient rows on explicit request", async () => {
    mocks.rows.mockResolvedValue([row, { ...row, id: "hidden", subject: "Provider failed" }]);
    mocks.states.mockResolvedValue({ "notification-1": { revision: 3, archived: true } });
    const payload = await (await GET(new Request("http://localhost/api/notifications/log?paginated=1&lifecycle=1"))).json();
    expect(mocks.states).toHaveBeenCalledWith("recipient-1", ["notification-1"]);
    expect(payload.items).toHaveLength(1); expect(payload.items[0].inboxState).toEqual({ revision: 3, archived: true });
  });
  it("does not silently present missing follow-up state when storage fails", async () => {
    mocks.states.mockRejectedValue(new Error("private details"));
    const result = await GET(new Request("http://localhost/api/notifications/log?lifecycle=1"));
    expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain("private details");
  });
  it("paginates by timestamp and id independently of cursor record existence", async () => {
    mocks.rows.mockResolvedValue(Array.from({ length: 201 }, (_, i) => ({ ...row, id: `n-${i}` })));
    const first = await (await GET(new Request("http://localhost/api/notifications/log?paginated=1"))).json();
    expect(first.items).toHaveLength(200);
    expect(first.nextCursor).toEqual(expect.any(String));
    mocks.rows.mockResolvedValue([]);
    const next = await GET(new Request(`http://localhost/api/notifications/log?paginated=1&cursor=${first.nextCursor}`));
    expect(await next.json()).toEqual({ items: [], nextCursor: null });
    expect(mocks.rows).toHaveBeenLastCalledWith({
      where: { userId: "recipient-1", channel: "PUSH", OR: [
        { createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: "n-199" } },
      ] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 201,
    });
  });

  it("advances across hidden diagnostics", async () => {
    mocks.rows.mockResolvedValue(Array.from({ length: 201 }, (_, i) => ({ ...row, id: `n-${i}`, subject: "Provider failed" })));
    const payload = await (await GET(new Request("http://localhost/api/notifications/log?paginated=1"))).json();
    expect(payload.items).toEqual([]);
    expect(payload.nextCursor).toEqual(expect.any(String));
  });

  it.each(["%", "", Buffer.from(JSON.stringify({ userId: "other", id: "n", createdAt: row.createdAt })).toString("base64url"),
    Buffer.from(JSON.stringify({ userId: "recipient-1", id: "n", createdAt: "invalid" })).toString("base64url")
  ])("rejects invalid or another recipient's cursor", async (cursor) => {
    const result = await GET(new Request(`http://localhost/api/notifications/log?paginated=1&cursor=${encodeURIComponent(cursor)}`));
    expect(result.status).toBe(400);
    expect(mocks.rows).not.toHaveBeenCalled();
  });

  it.each([
    [Role.ADMIN, "/v2/admin/jobs/job-1"],
    [Role.OPS_MANAGER, "/v2/admin/jobs/job-1"],
    [Role.CLIENT, "/v2/client/jobs/job-1"],
    [Role.VA, "/v2/client/jobs/job-1"],
    [Role.CLEANER, "/v2/cleaner/jobs/job-1"],
    [Role.QA_INSPECTOR, "/v2/qa/jobs/job-1"],
    [Role.LAUNDRY, "/v2/laundry"],
    [Role.MAINTENANCE, "/v2/maintenance"],
  ])("scopes %s to its own push records and portal", async (role, href) => {
    mocks.session.mockResolvedValue({ user: { id: "recipient-1", role } });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.rows).toHaveBeenCalledWith({
      where: { userId: "recipient-1", channel: "PUSH" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200,
    });
    const payload = await response.json();
    expect(payload[0]).toMatchObject({ id: row.id, href, createdAt: row.createdAt.toISOString() });
    expect(payload[0]).not.toHaveProperty("errorMsg");
    expect(payload[0]).not.toHaveProperty("externalId");
  });

  it("respects the explicit classic portal preference", async () => {
    mocks.cookie.mockReturnValue({ value: "v1" });
    expect((await (await GET()).json())[0].href).toBe("/cleaner/jobs/job-1");
  });

  it("hides delivery diagnostics from end users", async () => {
    mocks.rows.mockResolvedValue([row, { ...row, id: "internal", subject: "Provider failed" }]);
    expect((await (await GET()).json()).map((item: { id: string }) => item.id)).toEqual([row.id]);
  });

  it("returns an honest empty history", async () => {
    mocks.rows.mockResolvedValue([]);
    expect(await (await GET()).json()).toEqual([]);
  });

  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]])("stops %s before querying", async (message, status) => {
    mocks.session.mockRejectedValue(new Error(message as string));
    const response = await GET();
    expect(response.status).toBe(status);
    expect(mocks.rows).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("does not disclose database details or pretend failure is an empty inbox", async () => {
    mocks.rows.mockRejectedValue(new Error("database password/private host"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Could not load notifications." });
  });
});

describe("notification read lifecycle", () => {
  const patch = (body: unknown) => PATCH(new Request("http://localhost/api/notifications/log", { method: "PATCH", body: JSON.stringify(body) }));
  it.each(Object.values(Role))("restricts %s read updates to own push records", async role => {
    mocks.session.mockResolvedValue({ user: { id: "recipient-1", role } });
    mocks.update.mockResolvedValue({ count: 1 });
    const response = await patch({ ids: ["n1", "n1"] });
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { userId: "recipient-1", channel: "PUSH", id: { in: ["n1"] }, status: "SENT", OR: [{ deliveryStatus: null }, { deliveryStatus: "OPENED" }] }, data: { deliveryStatus: "OPENED" } });
  });
  it.each([null, {}, { ids: [] }, { ids: [42] }, { ids: Array(201).fill("n") }])("rejects invalid IDs", async body => {
    expect((await patch(body)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not consume notifications while impersonating", async () => {
    mocks.session.mockResolvedValue({ user: { id: "recipient-1", role: Role.CLEANER }, impersonation: { mode: "INTERACTIVE" } });
    expect((await patch({ ids: ["n"] })).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not expose persistence errors", async () => {
    mocks.update.mockRejectedValue(new Error("private DB details"));
    const response = await patch({ ids: ["n"] });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private DB");
  });
  it("exposes persisted opened state independently of provider acceptance", async () => {
    mocks.rows.mockResolvedValue([{ ...row, deliveryStatus: "OPENED" }, { ...row, id: "two", deliveryStatus: "DELIVERED" }]);
    expect((await (await GET()).json()).map((item: { isRead: boolean }) => item.isRead)).toEqual([true, false]);
  });
});

it("does not overwrite provider delivery states when marking inbox records read", async () => {
  mocks.rows.mockResolvedValue(["PENDING", "DELIVERED", "BOUNCED", "SKIPPED"].map((deliveryStatus, index) => ({ ...row, id: String(index), deliveryStatus })));
  expect((await (await GET()).json()).every((item: { canMarkRead: boolean }) => !item.canMarkRead)).toBe(true);
  mocks.rows.mockResolvedValue([{ ...row, status: "FAILED", deliveryStatus: null }]);
  expect((await (await GET()).json())[0].canMarkRead).toBe(false);
});
