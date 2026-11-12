// @vitest-environment node
/**
 * Quote PATCH stale-write guard and office notes (owner decision 2026-11-13).
 *
 * - A matching `expectedUpdatedAt` writes (conditionally, on that version).
 * - A mismatch answers 409 STALE_QUOTE with the current token and writes nothing.
 * - A write that loses the race between read and write is also 409, nothing written.
 * - No token: the old unconditional update (pipeline, v1 pages, mobile).
 * - An unreadable token is stale, never "no token".
 * - `internalNotes` is stored and a change is audited (before / after) in the
 *   same transaction; an unchanged value or other edits write no audit row.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORED = new Date("2026-11-13T01:02:03.456Z");

const m = vi.hoisted(() => {
  const tx = {
    quote: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    db: {
      quote: { findUnique: vi.fn() },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    },
    requireRole: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/cases/repair-quote", () => ({
  QuoteReferenceError: class QuoteReferenceError extends Error {},
  assertQuoteReferenceKeys: vi.fn(),
  caseForQuoteDetail: vi.fn(async () => null),
}));

import { PATCH } from "@/app/api/admin/quotes/[id]/route";
import { STALE_QUOTE_CODE, isStaleQuoteWrite } from "@/lib/quotes/quote-stale-guard";

function patch(body: Record<string, unknown>) {
  const req = new NextRequest("http://localhost/api/admin/quotes/q1", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return PATCH(req, { params: { id: "q1" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  m.db.quote.findUnique.mockResolvedValue({ status: "DRAFT", viewedAt: null, acceptedAt: null, declinedAt: null, publicToken: null, referenceImages: null });
  m.tx.quote.findUnique.mockResolvedValue({ updatedAt: STORED, internalNotes: "Gate code 4411" });
  m.tx.quote.updateMany.mockResolvedValue({ count: 1 });
  m.tx.quote.findUniqueOrThrow.mockResolvedValue({ id: "q1", updatedAt: new Date("2026-11-13T01:05:00.000Z") });
  m.tx.quote.update.mockResolvedValue({ id: "q1", updatedAt: new Date("2026-11-13T01:06:00.000Z") });
});

describe("isStaleQuoteWrite", () => {
  it("is not stale without an expectation, nor for the same instant in another spelling", () => {
    expect(isStaleQuoteWrite(STORED, undefined)).toBe(false);
    expect(isStaleQuoteWrite(STORED, STORED.toISOString())).toBe(false);
    expect(isStaleQuoteWrite(STORED, "2026-11-13T12:02:03.456+11:00")).toBe(false);
  });

  it("is stale for another version or an unreadable token", () => {
    expect(isStaleQuoteWrite(STORED, "2026-11-13T01:02:03.457Z")).toBe(true);
    expect(isStaleQuoteWrite(STORED, "yesterday-ish")).toBe(true);
  });
});

describe("PATCH /api/admin/quotes/[id] stale-write guard", () => {
  it("writes on the expected version when the token matches", async () => {
    const res = await patch({ notes: "Updated", expectedUpdatedAt: STORED.toISOString() });
    expect(res.status).toBe(200);
    expect(m.tx.quote.updateMany).toHaveBeenCalledWith({ where: { id: "q1", updatedAt: STORED }, data: { notes: "Updated" } });
    expect(m.tx.quote.update).not.toHaveBeenCalled();
    expect((await res.json()).updatedAt).toBe("2026-11-13T01:05:00.000Z");
  });

  it("answers 409 STALE_QUOTE with the current token and writes nothing on a mismatch", async () => {
    const res = await patch({ notes: "Mine", expectedUpdatedAt: "2026-11-12T00:00:00.000Z" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/changed somewhere else/), code: STALE_QUOTE_CODE, currentUpdatedAt: STORED.toISOString() });
    expect(m.tx.quote.updateMany).not.toHaveBeenCalled();
    expect(m.tx.quote.update).not.toHaveBeenCalled();
    expect(m.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("answers 409 when another write lands between the read and the conditional write", async () => {
    m.tx.quote.updateMany.mockResolvedValue({ count: 0 });
    m.tx.quote.findUnique
      .mockResolvedValueOnce({ updatedAt: STORED, internalNotes: null })
      .mockResolvedValueOnce({ updatedAt: new Date("2026-11-13T01:02:04.000Z") });
    const res = await patch({ internalNotes: "Mine", expectedUpdatedAt: STORED.toISOString() });
    expect(res.status).toBe(409);
    expect((await res.json()).currentUpdatedAt).toBe("2026-11-13T01:02:04.000Z");
    expect(m.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("treats an unreadable token as stale", async () => {
    const res = await patch({ notes: "Mine", expectedUpdatedAt: "not-a-date" });
    expect(res.status).toBe(409);
    expect(m.tx.quote.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the old unconditional update for callers that send no token", async () => {
    const res = await patch({ status: "SENT" });
    expect(res.status).toBe(200);
    expect(m.tx.quote.update).toHaveBeenCalledWith({ where: { id: "q1" }, data: { status: "SENT" } });
    expect(m.tx.quote.updateMany).not.toHaveBeenCalled();
  });

  it("guards status changes and the public link mint like any other edit", async () => {
    const res = await patch({ generatePublicToken: true, expectedUpdatedAt: "2026-11-12T00:00:00.000Z" });
    expect(res.status).toBe(409);
    expect(m.tx.quote.updateMany).not.toHaveBeenCalled();
  });

  it("answers 404 for a quote that no longer exists", async () => {
    m.tx.quote.findUnique.mockResolvedValue(null);
    const res = await patch({ notes: "x", expectedUpdatedAt: STORED.toISOString() });
    expect(res.status).toBe(404);
  });
});

describe("PATCH office notes", () => {
  it("stores the office notes and audits the change with before and after", async () => {
    const res = await patch({ internalNotes: "  Gate code 9902, ring first  ", expectedUpdatedAt: STORED.toISOString() });
    expect(res.status).toBe(200);
    expect(m.tx.quote.updateMany).toHaveBeenCalledWith({ where: { id: "q1", updatedAt: STORED }, data: { internalNotes: "Gate code 9902, ring first" } });
    expect(m.tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "admin-1",
        action: "QUOTE_INTERNAL_NOTES_UPDATED",
        entity: "Quote",
        entityId: "q1",
        before: { internalNotes: "Gate code 4411" },
        after: { internalNotes: "Gate code 9902, ring first" },
      },
    });
  });

  it("clears the office notes (empty means none) and audits it", async () => {
    await patch({ internalNotes: "", expectedUpdatedAt: STORED.toISOString() });
    expect(m.tx.quote.updateMany.mock.calls[0][0].data).toEqual({ internalNotes: null });
    expect(m.tx.auditLog.create.mock.calls[0][0].data.after).toEqual({ internalNotes: null });
  });

  it("writes no audit row when the office notes did not change or were not sent", async () => {
    await patch({ internalNotes: "Gate code 4411", expectedUpdatedAt: STORED.toISOString() });
    await patch({ notes: "Client text", expectedUpdatedAt: STORED.toISOString() });
    expect(m.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses office notes over 10,000 characters", async () => {
    const res = await patch({ internalNotes: "x".repeat(10_001) });
    expect(res.status).toBe(400);
    expect(m.tx.quote.update).not.toHaveBeenCalled();
  });
});
