// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/admin/notifications/intents/route";
const m = vi.hoisted(() => ({ session: vi.fn(), rows: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({ db: { notificationIntent: { findMany: m.rows } } }));
vi.mock("@/lib/notifications/intent-review", () => ({ reviewNotificationIntent: m.review }));
vi.mock("@/lib/notifications/intent-store", () => ({ NotificationIntentError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } }); m.rows.mockResolvedValue([]); m.review.mockResolvedValue({ id: "intent", status: "UNCERTAIN", updatedAt: new Date() }); });
const get = (status = "ATTENTION") => GET(new Request(`http://localhost/api/admin/notifications/intents?status=${status}`));
const patch = () => PATCH(new Request("http://localhost/api/admin/notifications/intents", { method: "PATCH", body: JSON.stringify({ id: "intent", action: "RECORD_INVESTIGATION", note: "Investigated", updatedAt: new Date().toISOString() }) }));
it.each(["ATTENTION", "QUEUED", "ACCEPTED", "SKIPPED"])("scopes queue to authorized operations and explicit status %s", async status => { const result = await get(status); expect(result.ok).toBe(true); expect(result.headers.get("cache-control")).toBe("private, no-store"); expect(m.session).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]); expect(m.rows.mock.calls[0][0].take).toBe(101); });
it("rejects invalid filter without storage", async () => { expect((await get("ALL_SECRETS")).status).toBe(400); expect(m.rows).not.toHaveBeenCalled(); });
it.each(["UNAUTHORIZED", "FORBIDDEN"])("denies %s before queue access or review", async error => { m.session.mockRejectedValue(new Error(error)); expect((await get()).status).toBe(error === "UNAUTHORIZED" ? 401 : 403); expect((await patch()).status).toBe(error === "UNAUTHORIZED" ? 401 : 403); expect(m.rows).not.toHaveBeenCalled(); expect(m.review).not.toHaveBeenCalled(); });
it("denies impersonation and never accepts actor from payload", async () => { m.session.mockResolvedValue({ user: { id: "admin", role: "ADMIN" }, impersonation: { mode: "INTERACTIVE" } }); expect((await patch()).status).toBe(403); expect(m.review).not.toHaveBeenCalled(); });
it("uses session actor and masks unexpected mutation failure", async () => { expect((await patch()).ok).toBe(true); expect(m.review.mock.calls[0][0]).toBe("admin"); m.review.mockRejectedValue(new Error("private database details")); const result = await patch(); expect(await result.json()).toEqual({ error: "Could not save delivery review." }); });
it("does not leak envelopes, leases or provider secrets in list", async () => { m.rows.mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ id: `row-${i}`, eventKey: "event", recipientId: "recipient", transport: "EMAIL", status: "UNCERTAIN", envelope: { secret: "private payload" }, leaseToken: "secret-token", attempts: [], updatedAt: new Date() }))); const result = await get(); const body = await result.json(); expect(body.items).toHaveLength(100); expect(body.hasMore).toBe(true); expect(JSON.stringify(body)).not.toContain("secret"); });
