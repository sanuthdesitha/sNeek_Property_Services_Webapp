// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ db: {} as any, update: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: "cleaner", role: "CLEANER" } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({}) }));
vi.mock("@/lib/cleaner/action-receipt", () => ({ ActionReceiptError: class extends Error {}, withCleanerAction: async (_: unknown, run: any) => run(m.db) }));
import { POST } from "@/app/api/cleaner/jobs/[id]/assignment-response/route";
beforeEach(() => {
 vi.clearAllMocks();
 m.db = { job: { findUnique: vi.fn().mockResolvedValue({ id: "child", reworkOfJobId: "parent", status: "OFFERED", assignments: [] }), update: m.update },
 jobAssignment: { findFirst: vi.fn().mockResolvedValue({ id: "assignment", userId: "cleaner", responseStatus: "PENDING" }), update: m.update },
 user: { findMany: vi.fn().mockResolvedValue([]) }, qaAssignment: { findFirst: vi.fn().mockResolvedValue({ reworkOfferStatus: "OFFERED" }) } };
});
it.each(["ACCEPT", "DECLINE", "TRANSFER"])("routes %s of original rework offer to explicit response flow", async action => {
 const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/child/assignment-response", { method: "POST", body: JSON.stringify({ action }) }), { params: { id: "child" } });
 expect(response.status).toBe(409);
 expect((await response.json()).code).toBe("REWORK_OFFER_RESPONSE_REQUIRED");
 expect(m.update).not.toHaveBeenCalled();
});

it("refuses generic acceptance of an unpublished draft before any assignment write", async () => {
 const { serializeJobInternalNotes } = await import("@/lib/jobs/meta");
 m.db.job.findUnique.mockResolvedValue({ id: "child", status: "OFFERED", internalNotes: serializeJobInternalNotes({ isDraft: true }) });
 const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/child/assignment-response", { method: "POST", body: JSON.stringify({ action: "ACCEPT" }) }), { params: { id: "child" } });
 expect(response.status).toBe(409); expect((await response.json()).error).toContain("draft"); expect(m.update).not.toHaveBeenCalled();
});
it("rejects a finished non-draft assignment before operational writes", async () => {
 m.db.job.findUnique.mockResolvedValue({ id: "child", status: "COMPLETED", internalNotes: null });
 const response = await POST(new NextRequest("http://localhost/api/cleaner/jobs/child/assignment-response", { method: "POST", body: JSON.stringify({ action: "ACCEPT" }) }), { params: { id: "child" } });
 expect(response.status).toBe(400); expect((await response.json()).error).toContain("finished"); expect(m.update).not.toHaveBeenCalled();
});
