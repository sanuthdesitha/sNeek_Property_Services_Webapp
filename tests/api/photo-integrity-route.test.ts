// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), assignment: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { qaAssignment: { findFirst: m.assignment } } }));
vi.mock("@/lib/media/photo-integrity-flags", () => ({ buildPhotoIntegrityReport: m.report }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
import { GET } from "@/app/api/qa/jobs/[id]/photo-integrity/route";

const flag = { kind: "reused_from_earlier_job", mediaId: "a", fieldLabel: "Kitchen", detail: "…", relatedJobId: "job-0", relatedMediaId: "old" };
const call = () => GET(new Request("http://local"), { params: { id: "job-1" } });
beforeEach(() => { vi.resetAllMocks(); m.report.mockResolvedValue({ hasSubmission: true, photos: [], flags: [flag], clockWindow: null, counts: {} }); });

it("serves office roles the full flags with the business time zone", async () => {
  m.role.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } });
  const response = await call();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ flags: [{ relatedJobId: "job-0" }], timezone: "Australia/Sydney" });
  expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER", "QA_INSPECTOR"]);
});

it("limits inspectors to assigned jobs and hides links to other jobs", async () => {
  m.role.mockResolvedValue({ user: { id: "qa", role: "QA_INSPECTOR", heldRoles: ["QA_INSPECTOR"] } });
  m.assignment.mockResolvedValueOnce(null);
  expect((await call()).status).toBe(403);
  expect(m.report).not.toHaveBeenCalled();
  m.assignment.mockResolvedValueOnce({ id: "assignment" });
  expect(await (await call()).json()).toMatchObject({ flags: [{ relatedJobId: null, relatedMediaId: null }] });
});

it("refuses clients, cleaners and signed-out requests (the role guard decides)", async () => {
  m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
  expect((await call()).status).toBe(403);
  m.role.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
  expect((await call()).status).toBe(401);
  expect(m.report).not.toHaveBeenCalled();
});
