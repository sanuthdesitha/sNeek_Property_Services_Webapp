// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { GET } from "@/app/api/notifications/stream/route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rows: vi.fn(), version: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/db", () => ({ db: { notification: { findMany: mocks.rows } } }));
vi.mock("@/lib/portal-version-store", () => ({ getDefaultPortalVersion: mocks.version }));

const now = new Date("2026-09-09T00:00:00Z");
const row = {
  id: "n-1", userId: "user-1", jobId: "job-1", channel: "PUSH",
  subject: "Job update", body: "Changed", status: "SENT",
  createdAt: new Date(now.getTime() + 1000), sentAt: null,
};
function session(role: Role = Role.CLEANER, id = "user-1") {
  // getServerSession(options) removes expires before requireSession returns it.
  return { user: { id, role } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const controllers: AbortController[] = [];
async function open(cookie?: string, alreadyAborted = false, lastEventId?: string) {
  const abort = new AbortController();
  controllers.push(abort);
  if (alreadyAborted) abort.abort();
  const req = new NextRequest("http://localhost/api/notifications/stream", {
    signal: abort.signal, headers: {
      ...(cookie ? { cookie } : {}),
      ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
    },
  });
  const remove = vi.spyOn(req.signal, "removeEventListener");
  const response = await GET(req);
  const reader = response.body!.getReader();
  return { abort, reader, response, remove };
}
async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const chunk = await reader.read();
  return chunk.done ? null : new TextDecoder().decode(chunk.value);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.session.mockReset().mockImplementation(async () => session());
  mocks.rows.mockReset().mockResolvedValue([]);
  mocks.version.mockReset().mockResolvedValue("v2");
});
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.abort());
  expect(vi.getTimerCount()).toBe(0);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("notification SSE route", () => {
  function cursorId(owner: string, timestamp: number, id = "") {
    return Buffer.from(JSON.stringify([1, owner, timestamp, id])).toString("base64url");
  }
  function emittedId(event: string | null) {
    return event!.split("\n").find((line) => line.startsWith("id: "))!.slice(4);
  }

  it.each([false, true])("replays the forced-reconnect gap with prior notification=%s", async (withNotification) => {
    const first = await open();
    let lastId = emittedId(await read(first.reader));
    expect(lastId).toBe(cursorId("user-1", now.getTime()));
    if (withNotification) {
      mocks.rows.mockResolvedValueOnce([row]);
      await vi.advanceTimersByTimeAsync(2500);
      lastId = emittedId(await read(first.reader));
      expect(lastId).toBe(cursorId("user-1", row.createdAt.getTime(), row.id));
    }
    await vi.advanceTimersByTimeAsync(withNotification ? 57_500 : 60_000);
    while (await read(first.reader) !== null) { /* Drain keepalives through closure. */ }
    const gapRow = { ...row, id: "n-gap", createdAt: new Date(now.getTime() + 61_000) };
    await vi.advanceTimersByTimeAsync(3000);
    mocks.rows.mockImplementation(async ({ where }) => {
      expect(where.userId).toBe("user-1");
      expect(where.channel).toBe("PUSH");
      const position = where.OR[1];
      expect(position).toEqual({ createdAt: withNotification ? row.createdAt : now, id: { gt: withNotification ? row.id : "" } });
      return [row, gapRow].filter((item) => item.createdAt > position.createdAt ||
        (item.createdAt.getTime() === position.createdAt.getTime() && item.id > position.id.gt));
    });
    const second = await open(undefined, false, lastId);
    expect(emittedId(await read(second.reader))).toBe(lastId);
    await vi.advanceTimersByTimeAsync(2500);
    if (!withNotification) expect(await read(second.reader)).toContain('"id":"n-1"');
    const event = await read(second.reader);
    expect(event).toContain('"id":"n-gap"');
    expect(event).toContain('"href":"/v2/cleaner/jobs/job-1"');
    expect(emittedId(event)).toBe(cursorId("user-1", gapRow.createdAt.getTime(), gapRow.id));
  });

  it.each([
    ["malformed", "not-json"],
    ["invalid alphabet", "bad!"],
    ["oversized", "a".repeat(1025)],
    ["future", cursorId("user-1", now.getTime() + 1)],
    ["old other user", cursorId("other", now.getTime() - 600_001)],
    ["old noncanonical", Buffer.from(JSON.stringify([1, "user-1", now.getTime() - 600_001, ""], null, 1)).toString("base64url")],
    ["other user", cursorId("other", now.getTime() - 1000)],
    ["oversized row id", cursorId("user-1", now.getTime(), "x".repeat(257))],
    ["control characters", cursorId("user-1", now.getTime(), "bad\nvalue")],
    ["wrong shape", Buffer.from(JSON.stringify({ userId: "user-1" })).toString("base64url")],
    ["wrong timestamp type", Buffer.from(JSON.stringify([1, "user-1", "today", ""])).toString("base64url")],
  ])("resets %s cursors to a fresh scoped baseline", async (_label, lastId) => {
    const { reader } = await open(undefined, false, lastId);
    expect(emittedId(await read(reader))).toBe(cursorId("user-1", now.getTime()));
    await vi.advanceTimersByTimeAsync(2500);
    expect(mocks.rows.mock.calls[0][0].where).toMatchObject({
      userId: "user-1", channel: "PUSH", OR: [{ createdAt: { gt: now } }, { createdAt: now, id: { gt: "" } }],
    });
  });

  it("replays recent gap events after more than ten quiet minutes", async () => {
    const first = await open();
    const lastId = emittedId(await read(first.reader));
    await vi.advanceTimersByTimeAsync(60_000);
    while (await read(first.reader) !== null) { /* Drain the closed stream. */ }
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    const reconnectAt = Date.now();
    const floor = new Date(reconnectAt - 600_000);
    const gapRow = { ...row, id: "n-gap", createdAt: new Date(reconnectAt - 1000) };
    mocks.rows.mockImplementation(async ({ where }) => {
      expect(where).toMatchObject({ userId: "user-1", channel: "PUSH" });
      expect(where.OR).toEqual([
        { createdAt: { gt: floor } }, { createdAt: floor, id: { gt: "" } },
      ]);
      return [row, gapRow].filter((item) => item.createdAt > where.OR[0].createdAt.gt);
    });
    const second = await open(undefined, false, lastId);
    expect(emittedId(await read(second.reader))).toBe(cursorId("user-1", floor.getTime()));
    await vi.advanceTimersByTimeAsync(2500);
    const event = await read(second.reader);
    expect(event).toContain('"id":"n-gap"');
    expect(event).not.toContain('"id":"n-1"');
  });

  it("accepts the replay window boundary while retaining timestamp tie-breaking", async () => {
    const timestamp = now.getTime() - 600_000;
    const lastId = cursorId("user-1", timestamp, "n-previous");
    const { reader } = await open(undefined, false, lastId);
    expect(emittedId(await read(reader))).toBe(lastId);
    await vi.advanceTimersByTimeAsync(2500);
    expect(mocks.rows.mock.calls[0][0].where.OR[1]).toEqual({ createdAt: new Date(timestamp), id: { gt: "n-previous" } });
  });

  it("rejects unauthenticated connections without timers", async () => {
    mocks.session.mockRejectedValue(new Error("UNAUTHORIZED"));
    const response = await GET(new NextRequest("http://localhost/api/notifications/stream"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(mocks.rows).not.toHaveBeenCalled();
  });

  it.each([
    [Role.CLEANER, undefined, "/v2/cleaner/jobs/job-1"],
    [Role.QA_INSPECTOR, "sneek.portal-version=v1", "/qa/jobs/job-1"],
    [Role.ADMIN, undefined, "/v2/admin/jobs/job-1"],
  ])("emits scoped, version-aware links for %s", async (role, cookie, href) => {
    mocks.session.mockImplementation(async () => session(role));
    mocks.rows.mockResolvedValueOnce([row]);
    const { reader, response } = await open(cookie);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await read(reader)).toContain("event: ready");
    await vi.advanceTimersByTimeAsync(2500);
    const event = await read(reader);
    expect(event).toContain("event: notification");
    expect(JSON.parse(event!.split("data: ")[1])).toMatchObject({ id: "n-1", href });
    expect(mocks.rows.mock.calls[0][0]).toMatchObject({
      where: { userId: "user-1", channel: "PUSH" }, take: 100,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(mocks.session).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2500);
    expect(mocks.rows.mock.calls[1][0].where.OR).toEqual([
      { createdAt: { gt: row.createdAt } }, { createdAt: row.createdAt, id: { gt: row.id } },
    ]);
  });

  it.each(["lost", "role", "identity", "impersonation", "expired"])("closes on %s auth before querying", async (change) => {
    const { reader } = await open();
    await read(reader);
    if (change === "lost") mocks.session.mockRejectedValue(new Error("UNAUTHORIZED"));
    if (change === "role") mocks.session.mockResolvedValue(session(Role.QA_INSPECTOR));
    if (change === "identity") mocks.session.mockResolvedValue(session(Role.CLEANER, "other"));
    if (change === "impersonation") mocks.session.mockResolvedValue({ ...session(), impersonation: { actorId: "admin", mode: "READ_ONLY", startedAt: 1 } });
    if (change === "expired") mocks.session.mockResolvedValue({ ...session(), expires: now.toISOString() });
    await vi.advanceTimersByTimeAsync(2500);
    expect(await read(reader)).toBeNull();
    expect(mocks.rows).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overlap pending auth or database polls and emits a batch only once", async () => {
    const { reader } = await open();
    await read(reader);
    const auth = deferred<ReturnType<typeof session>>();
    const query = deferred<typeof row[]>();
    mocks.session.mockReturnValueOnce(auth.promise);
    mocks.rows.mockReturnValueOnce(query.promise);
    await vi.advanceTimersByTimeAsync(7500);
    expect(mocks.session).toHaveBeenCalledTimes(2);
    expect(mocks.rows).not.toHaveBeenCalled();
    auth.resolve(session());
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.rows).toHaveBeenCalledTimes(1);
    query.resolve([row]);
    await vi.advanceTimersByTimeAsync(0);
    expect(await read(reader)).toContain('"id":"n-1"');
    await reader.cancel();
    expect(await read(reader)).toBeNull();
  });

  it("discards query results when auth is revoked in flight", async () => {
    const pending = deferred<typeof row[]>();
    mocks.rows.mockReturnValueOnce(pending.promise);
    const { reader } = await open();
    await read(reader);
    await vi.advanceTimersByTimeAsync(2500);
    mocks.session.mockRejectedValue(new Error("UNAUTHORIZED"));
    pending.resolve([row]);
    await vi.advanceTimersByTimeAsync(0);
    expect(await read(reader)).toBeNull();
  });

  it.each(["abort", "cancel"])("cleans up %s while a query is pending", async (action) => {
    const pending = deferred<typeof row[]>();
    mocks.rows.mockReturnValueOnce(pending.promise);
    const { reader, abort, remove } = await open();
    await read(reader);
    await vi.advanceTimersByTimeAsync(2500);
    if (action === "abort") abort.abort();
    else await reader.cancel();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    pending.resolve([row]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await read(reader)).toBeNull();
    expect(mocks.session).toHaveBeenCalledTimes(2);
    expect(mocks.rows).toHaveBeenCalledTimes(1);
  });

  it("handles requests aborted before stream construction", async () => {
    const { reader, remove } = await open(undefined, true);
    expect(await read(reader)).toBeNull();
    expect(remove).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("expires at the original session deadline even with hung authentication", async () => {
    mocks.session.mockResolvedValueOnce({ ...session(), expires: new Date(now.getTime() + 4000).toISOString() });
    const { reader } = await open();
    await read(reader);
    const pending = deferred<ReturnType<typeof session>>();
    mocks.session.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await read(reader)).toBeNull();
    pending.resolve(session());
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rows).not.toHaveBeenCalled();
  });

  it("bounds cookie snapshots to 60 seconds and stops keepalives", async () => {
    const { reader } = await open();
    await read(reader);
    await vi.advanceTimersByTimeAsync(60_000);
    let keepalives = 0;
    for (let chunk = await read(reader); chunk !== null; chunk = await read(reader)) {
      expect(chunk).toContain(": keepalive");
      keepalives++;
    }
    expect(keepalives).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers from query failures and advances past hidden notifications", async () => {
    mocks.rows.mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce([{ ...row, body: "Email sent to customer" }]);
    const { reader } = await open();
    await read(reader);
    await vi.advanceTimersByTimeAsync(7500);
    expect(mocks.rows).toHaveBeenCalledTimes(3);
    expect(mocks.rows.mock.calls[2][0].where.OR[1].id.gt).toBe(row.id);
    await vi.advanceTimersByTimeAsync(7500);
    expect(await read(reader)).toContain(": keepalive");
  });
});
