// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), assignment: vi.fn(), cleaners: vi.fn(), template: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({ db: {
  jobAssignment: { findMany: m.cleaners }, qaAssignment: { findFirst: m.assignment },
  qaFormTemplate: { findUnique: m.template }, $transaction: m.write,
} }));
vi.mock("@/lib/reports/generator", () => ({ generateJobReport: vi.fn() }));
vi.mock("@/lib/notifications/accountability", () => ({}));
vi.mock("@/lib/qa/rework-jobs", () => ({}));
vi.mock("@/lib/qa/rework-transfers", () => ({}));
vi.mock("@/lib/cases/service", () => ({}));
vi.mock("@/lib/qa/annotation-composite", () => ({}));
vi.mock("@/lib/s3", () => ({}));
vi.mock("@/lib/settings", () => ({}));
vi.mock("@/lib/accountability/patterns", () => ({}));
vi.mock("@/lib/qa/reopen-facts", () => ({}));
import { POST } from "@/app/api/qa/jobs/[id]/route";
import { requireQaSubmitAssignment } from "@/lib/qa/submit-access";
import { Role } from "@prisma/client";
const run = (extra = {}) => POST(new Request("http://localhost/api/qa/jobs/foreign", { method: "POST", body: JSON.stringify({ templateId: "t", data: {}, ...extra }) }) as any, { params: { id: "foreign" } });
beforeEach(() => {
 vi.clearAllMocks(); m.session.mockResolvedValue({ user: { id: "qa", role: "CLEANER", heldRoles: ["CLEANER", "QA_INSPECTOR"] } });
 m.cleaners.mockResolvedValue([]); m.assignment.mockResolvedValue(null);
});
it("direct submit without assignmentId cannot inspect an unowned job, under another active hat", async () => {
 const res = await run(); expect(res.status).toBe(403); expect(m.template).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled();
 expect(m.assignment.mock.calls[0][0].where).toMatchObject({ jobId: "foreign", AND: expect.any(Array) });
});
it("direct submit rejects self-review before any form or mutation", async () => {
 m.cleaners.mockResolvedValue([{ userId: "qa" }]);
 const res = await run({ assignmentId: "owned" }); expect(res.status).toBe(400); expect((await res.json()).error).toMatch(/you cleaned this job/i);
 expect(m.assignment).not.toHaveBeenCalled(); expect(m.template).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled();
});
it("server resolves an owned assignment when the client omitted its id", async () => {
 m.assignment.mockResolvedValue({ id: "owned" });
 expect(await requireQaSubmitAssignment({ jobId: "j", userId: "qa", roles: [Role.QA_INSPECTOR] })).toEqual({ id: "owned" });
});
it("amendment requires an in-progress reopened assignment", async () => {
 await expect(requireQaSubmitAssignment({ jobId: "j", userId: "qa", roles: [Role.ADMIN], amending: true })).rejects.toThrow("FORBIDDEN");
 expect(m.assignment.mock.calls[0][0].where.status).toBe("IN_PROGRESS");
});

it("requires the explicit device-exception reason before QA submission writes", async () => {
 m.assignment.mockResolvedValue({ id: "owned" });
 m.template.mockResolvedValue({ schema: { sections: [{ fields: [{ id: "minut", type: "checkbox", label: "Minut charged?" }] }] } });
 const response = await run({ data: { minut: { deviceStatus: "NOT_CHECKED", reason: " " } } });
 expect(response.status).toBe(400);
 expect((await response.json()).missingRequiredFields).toEqual([{ id: "minut", label: "Minut charged?" }]);
 expect(m.write).not.toHaveBeenCalled();
});
