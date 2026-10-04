// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), read: vi.fn(), comment: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/cases/service", () => ({ getCaseById: m.read, addCaseComment: m.comment }));
vi.mock("@/lib/cases/notifications", () => ({ notifyCaseUpdated: m.notify }));
import { POST } from "@/app/api/admin/cases/[id]/comments/route";
beforeEach(() => { vi.resetAllMocks(); m.role.mockResolvedValue({ user: { id: "admin" } }); m.read.mockResolvedValue({ id: "c" }); m.comment.mockResolvedValue({ id: "c", clientVisible: true }); });
it("omitted visibility is private and suppresses client notification", async () => {
 const res = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ body: "Internal assessment" }) }) as any, { params: { id: "c" } });
 expect(res.status).toBe(200); expect(m.comment.mock.calls[0][0].isInternal).toBe(true); expect(m.notify.mock.calls[0][0].notifyClient).toBe(false);
});
it("explicit public comment retains supported public update behavior", async () => {
 await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ body: "Client update", isInternal: false }) }) as any, { params: { id: "c" } });
 expect(m.comment.mock.calls[0][0].isInternal).toBe(false); expect(m.notify.mock.calls[0][0].notifyClient).toBe(true);
});
