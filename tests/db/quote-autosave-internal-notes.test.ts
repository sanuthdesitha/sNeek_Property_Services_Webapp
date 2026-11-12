// @vitest-environment node
/**
 * Quote PATCH stale-write guard and office notes on a real disposable
 * PostgreSQL (127.0.0.1:55439), owner decision 2026-11-13:
 *
 * - matching token writes; a stale token is 409 STALE_QUOTE and the row is
 *   byte-for-byte unchanged; no token keeps the old unconditional write;
 * - two saves sent on the same version at the same moment: exactly one lands;
 * - an office-notes change writes one AuditLog row (actor, before, after) in the
 *   same transaction; an unchanged value writes none;
 * - the stored office notes do not appear in the public quote payload or the
 *   client's Approvals rows.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, actorId: "" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/auth/session", () => ({ requireRole: vi.fn(async () => ({ user: { id: m.actorId, role: "ADMIN" } })) }));

import { PATCH } from "@/app/api/admin/quotes/[id]/route";
import { issueQuoteNumber } from "@/lib/quotes/quote-number";
import { buildPublicQuotePayload, findQuoteByToken } from "@/app/api/public/quote-view/_lib";
import { listQuotesWaiting } from "@/lib/client/quotes-waiting";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `qnotes-${randomUUID().slice(0, 8)}`;
const ids = { admin: randomUUID(), client: randomUUID() };
const quoteIds: string[] = [];
const SECRET = `OFFICE-ONLY-${tag}`;

function patch(quoteId: string, body: Record<string, unknown>) {
  const req = new NextRequest(`http://localhost/api/admin/quotes/${quoteId}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return PATCH(req, { params: { id: quoteId } });
}

async function newQuote(): Promise<{ id: string; updatedAt: Date }> {
  const quote = await m.client.$transaction(async (tx) => {
    const quoteNumber = await issueQuoteNumber(tx);
    return tx.quote.create({
      data: {
        quoteNumber,
        clientId: ids.client,
        serviceType: "DEEP_CLEAN",
        lineItems: [{ label: "Deep clean", unitPrice: 480, qty: 1, total: 480 }],
        subtotal: 480,
        gstAmount: 48,
        totalAmount: 528,
        notes: "Client-visible scope",
        status: "SENT",
        publicToken: `tok${randomUUID().replace(/-/g, "")}`,
      },
    });
  });
  quoteIds.push(quote.id);
  return quote;
}

describe.skipIf(!url)("quote stale-write guard and office notes (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    m.actorId = ids.admin;
    await m.client.user.create({ data: { id: ids.admin, email: `${tag}-admin@example.invalid`, name: "Ada", role: Role.ADMIN } });
    await m.client.client.create({ data: { id: ids.client, name: `Harbour ${tag}`, email: `${tag}-client@example.invalid` } });
  });

  afterAll(async () => {
    if (!m.client) return;
    await m.client.auditLog.deleteMany({ where: { userId: ids.admin } });
    await m.client.quoteEvent.deleteMany({ where: { quoteId: { in: quoteIds } } });
    await m.client.quote.deleteMany({ where: { id: { in: quoteIds } } });
    await m.client.client.deleteMany({ where: { id: ids.client } });
    await m.client.user.deleteMany({ where: { id: ids.admin } });
    await m.client.$disconnect();
  });

  it("writes on a matching token, refuses a stale one without writing, and keeps tokenless callers working", async () => {
    const quote = await newQuote();
    const ok = await patch(quote.id, { notes: "First edit", expectedUpdatedAt: quote.updatedAt.toISOString() });
    expect(ok.status).toBe(200);
    const saved = await ok.json();
    expect(saved.notes).toBe("First edit");
    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(quote.updatedAt.getTime());

    const before = await m.client.quote.findUniqueOrThrow({ where: { id: quote.id } });
    const stale = await patch(quote.id, { notes: "Overwrite attempt", expectedUpdatedAt: quote.updatedAt.toISOString() });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "STALE_QUOTE", currentUpdatedAt: before.updatedAt.toISOString() });
    expect(await m.client.quote.findUniqueOrThrow({ where: { id: quote.id } })).toEqual(before);

    const legacy = await patch(quote.id, { notes: "Pipeline edit" });
    expect(legacy.status).toBe(200);
    expect((await m.client.quote.findUniqueOrThrow({ where: { id: quote.id } })).notes).toBe("Pipeline edit");
  });

  it("lets exactly one of two saves on the same version land", async () => {
    const quote = await newQuote();
    const token = quote.updatedAt.toISOString();
    const results = await Promise.all([
      patch(quote.id, { internalNotes: "Tab A", expectedUpdatedAt: token }),
      patch(quote.id, { internalNotes: "Tab B", expectedUpdatedAt: token }),
    ]);
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409]);
    const winner = results.find((res) => res.status === 200)!;
    const stored = await m.client.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(stored.internalNotes).toBe((await winner.json()).internalNotes);
    const audits = await m.client.auditLog.findMany({ where: { entityId: quote.id, action: "QUOTE_INTERNAL_NOTES_UPDATED" } });
    expect(audits).toHaveLength(1);
  });

  it("audits office-notes changes with actor, before and after, and never shows them to the client", async () => {
    const quote = await newQuote();
    const first = await patch(quote.id, { internalNotes: SECRET, expectedUpdatedAt: quote.updatedAt.toISOString() });
    expect(first.status).toBe(200);
    const token = (await first.json()).updatedAt as string;
    const same = await patch(quote.id, { internalNotes: SECRET, expectedUpdatedAt: token });
    expect(same.status).toBe(200);

    const audits = await m.client.auditLog.findMany({ where: { entityId: quote.id, action: "QUOTE_INTERNAL_NOTES_UPDATED" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: ids.admin, entity: "Quote", before: { internalNotes: null }, after: { internalNotes: SECRET } });

    const stored = await m.client.quote.findUniqueOrThrow({ where: { id: quote.id } });
    const publicQuote = await findQuoteByToken(stored.publicToken!);
    expect(publicQuote?.internalNotes).toBe(SECRET);
    const payload = await buildPublicQuotePayload(publicQuote!);
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(JSON.stringify(payload)).not.toContain("internalNotes");

    const waiting = await listQuotesWaiting(ids.client);
    expect(waiting.map((row) => row.id)).toContain(quote.id);
    expect(JSON.stringify(waiting)).not.toContain(SECRET);
  });
});
