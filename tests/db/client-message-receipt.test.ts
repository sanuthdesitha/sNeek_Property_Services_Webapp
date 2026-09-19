// @vitest-environment node
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/client/messages/route";
const m = vi.hoisted(() => ({ client: null as any, id: "", role: "CLIENT", push: vi.fn(), email: vi.fn(), failAudit: false, impersonation: undefined as any, onLock: undefined as (() => void) | undefined }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) {
  if (key === "$transaction") return (run: any, ...args: any[]) => typeof run === "function" ? m.client.$transaction((tx: any) => run(new Proxy(tx, { get(target, member) { const value = target[member]; if (member === "$executeRaw") return (...query: any[]) => { m.onLock?.(); return value.apply(target, query); }; return typeof value === "function" ? value.bind(target) : value; } })), ...args) : m.client.$transaction(run, ...args);
  const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value;
} }) }));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => ({ user: { id: m.id, role: m.role }, impersonation: m.impersonation }) }));
vi.mock("@/lib/notifications/admin-alerts", () => ({ notifyAdminsByPush: m.push, notifyAdminsByEmail: m.email }));
vi.mock("@/lib/auth/client-portal", async importOriginal => { const actual: any = await importOriginal(); return { ...actual, auditClientPortalAction: async (...args: any[]) => { if (m.failAudit) throw new Error("Audit unavailable"); return actual.auditClientPortalAction(...args); } }; });
const url = process.env.SNEEK_TEST_DATABASE_URL; let id = ""; let context = "";
const send = (requestId: string, body = "Message <b>plain text</b>", header = context) => POST(new NextRequest("http://localhost/api/client/messages", { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Message-Context": header }, body: JSON.stringify({ requestId, body, jobId: id }) }));
describe.skipIf(!url)("client message receipts (explicit loopback DB)", () => {
  beforeAll(async () => { const parsed = new URL(url!); if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/^postgres(ql)?:$/.test(parsed.protocol) || Array.from(parsed.searchParams.keys()).some(key => ["host", "hostaddr"].includes(key.toLowerCase()))) throw new Error("Loopback DB required"); m.client = new PrismaClient({ datasources: { db: { url } } }); await m.client.$connect(); });
  beforeEach(async () => {
    id = `c${randomUUID().replace(/-/g, "")}`; m.id = id; m.role = "CLIENT"; m.failAudit = false; m.impersonation = undefined; m.onLock = undefined; m.push.mockReset().mockResolvedValue(undefined); m.email.mockReset().mockResolvedValue(undefined);
    await m.client.client.create({ data: { id, name: "Client <script>fixture</script>" } });
    await m.client.user.create({ data: { id, clientId: id, role: "CLIENT", email: `${id}@example.invalid` } });
    await m.client.property.create({ data: { id, clientId: id, name: "Property <tag>", address: "1 Test Street", suburb: "Sydney" } });
    await m.client.job.create({ data: { id, jobNumber: id, propertyId: id, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date() } });
    const feed = await GET(new NextRequest(`http://localhost/api/client/messages?jobId=${id}&withContext=1`)); expect(feed.status).toBe(200); context = feed.headers.get("X-Client-Message-Context")!; expect(context).toMatch(/^[a-f0-9]{64}$/);
  });
  afterEach(async () => { await m.client.auditLog.deleteMany({ where: { userId: id } }); await m.client.clientMessage.deleteMany({ where: { clientId: id } }); await m.client.job.deleteMany({ where: { id } }); await m.client.property.deleteMany({ where: { id } }); await m.client.user.updateMany({ where: { id }, data: { vaTeamId: null } }); await m.client.vaTeam.deleteMany({ where: { id } }); await m.client.user.deleteMany({ where: { id } }); await m.client.client.deleteMany({ where: { id } }); });
  afterAll(async () => { await m.client?.$disconnect(); });
  it("serializes concurrent retries into one message, one audit, and one notification attempt each", async () => {
    const requestId = randomUUID(); const responses = await Promise.all([send(requestId), send(requestId)]); expect(responses.map(row => row.status).sort()).toEqual([200, 201]);
    const first = await responses[0].json(), second = await responses[1].json(); expect(first.id).toBe(second.id); expect(first.sentBy.id).toBe(id); expect(responses[0].headers.get("X-Client-Message-Context")).toBe(context);
    expect(await m.client.clientMessage.count({ where: { clientId: id } })).toBe(1); expect(await m.client.auditLog.count({ where: { userId: id, action: "message.post" } })).toBe(1); expect(m.push).toHaveBeenCalledOnce(); expect(m.email).toHaveBeenCalledOnce();
    expect(m.email.mock.calls[0][0].html).toContain("&lt;b&gt;plain text&lt;/b&gt;"); expect(m.email.mock.calls[0][0].html).not.toContain("<script>");
    expect(m.push.mock.calls[0][0].jobId).toBe(id);
  });
  it("returns a persisted acknowledgement after delivery rejection without resending on retry", async () => {
    m.push.mockRejectedValue(new Error("provider unavailable")); const requestId = randomUUID(); const first = await send(requestId); expect(first.status).toBe(201); expect(await first.json()).toMatchObject({ deliveryWarning: expect.stringContaining("Message saved") });
    expect((await send(requestId)).status).toBe(200); expect(m.push).toHaveBeenCalledOnce(); expect(m.email).toHaveBeenCalledOnce();
  });
  it("rejects changed content/context and binds full impersonation to the actual actor", async () => {
    const requestId = randomUUID(); expect((await send(requestId)).status).toBe(201); expect((await send(requestId, "Different body")).status).toBe(409);
    m.impersonation = { actorId: "actual-admin", mode: "FULL", startedAt: "2026-09-13T00:00:00Z" }; expect((await send(randomUUID())).status).toBe(409);
    const feed = await GET(new NextRequest(`http://localhost/api/client/messages?jobId=${id}&withContext=1`)); const changed = feed.headers.get("X-Client-Message-Context")!;
    expect(changed).not.toBe(context); expect((await send(randomUUID(), "Full impersonation authorized", changed)).status).toBe(201);
  });
  it("rolls back the message when its audit cannot persist", async () => {
    m.failAudit = true; expect((await send(randomUUID())).status).toBe(400); expect(await m.client.clientMessage.count({ where: { clientId: id } })).toBe(0); expect(m.push).not.toHaveBeenCalled();
  });
  it("refuses a job that was removed after loading the context", async () => {
    await m.client.job.delete({ where: { id } }); expect((await send(randomUUID())).status).toBe(404); expect(await m.client.clientMessage.count({ where: { clientId: id } })).toBe(0);
  });
  it("serves the latest 500 in chronological order with an explicit history limit", async () => {
    await m.client.clientMessage.createMany({ data: Array.from({ length: 501 }, (_, index) => ({ id: `${id}-${index}`, clientId: id, jobId: id, sentById: id, body: `message ${index}`, createdAt: new Date(1000 * index) })) });
    const feed = await GET(new NextRequest(`http://localhost/api/client/messages?jobId=${id}&withContext=1`)); const rows = await feed.json(); expect(feed.headers.get("X-Client-Message-History-Limited")).toBe("true"); expect(rows).toHaveLength(500); expect(rows[0].body).toBe("message 1"); expect(rows[499].body).toBe("message 500");
  });
  it("revalidates VA grants after waiting on the request lock", async () => {
    await m.client.vaTeam.create({ data: { id, clientId: id, name: "Fixture team", createdById: id, permissions: { messages: true }, propertyIds: [id] } }); await m.client.user.update({ where: { id }, data: { vaTeamId: id, role: "VA" } }); m.role = "VA";
    const feed = await GET(new NextRequest(`http://localhost/api/client/messages?jobId=${id}&withContext=1`)); context = feed.headers.get("X-Client-Message-Context")!;
    const requestId = randomUUID(); const key = `cm_${createHash("sha256").update(JSON.stringify([id, id, id, context, requestId])).digest("hex")}`;
    let acquired!: () => void, release!: () => void, attempting!: () => void; const held = new Promise<void>(done => acquired = done), released = new Promise<void>(done => release = done), attempted = new Promise<void>(done => attempting = done);
    const holder = m.client.$transaction(async (tx: any) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`; acquired(); await released; }); await held; m.onLock = attempting;
    const pending = send(requestId); await attempted; await m.client.vaTeam.update({ where: { id }, data: { permissions: { messages: false } } }); release(); await holder;
    expect((await pending).status).toBe(403); expect(await m.client.clientMessage.count({ where: { clientId: id } })).toBe(0); expect(m.push).not.toHaveBeenCalled();
  });
  it("preserves legacy no-requestId posts and rejects read-only impersonation", async () => {
    const legacy = await POST(new NextRequest("http://localhost/api/client/messages", { method: "POST", body: JSON.stringify({ body: "Legacy post" }) })); expect(legacy.status).toBe(201); expect((await legacy.json()).requestId).toBeUndefined();
    m.impersonation = { actorId: "admin", mode: "READ_ONLY", startedAt: "now" }; expect((await send(randomUUID())).status).toBe(403);
  });
  it("reports fulfilled email configuration failure as saved but unconfirmed delivery", async () => {
    m.email.mockResolvedValue({ ok: false, error: "Email unavailable" }); const requestId = randomUUID(); const response = await send(requestId);
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ deliveryWarning: expect.stringContaining("Message saved") });
    expect((await send(requestId)).status).toBe(200); expect(m.email).toHaveBeenCalledOnce();
  });
});
