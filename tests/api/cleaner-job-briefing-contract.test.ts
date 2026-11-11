// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: vi.fn(), job: vi.fn(), history: vi.fn(), laundry: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/db", () => ({ db: { job: { findFirst: mocks.job, findMany: mocks.history }, laundryTask: { findFirst: mocks.laundry } } }));
vi.mock("@/lib/security/encryption", () => ({ decryptSecret: (value: unknown) => value }));
vi.mock("@/lib/qa/feedback-history", () => ({ getNegativeQaWarning: async () => null }));
vi.mock("@/lib/qa/rework-transfers", () => ({ listConfirmedReworkForCleanerJob: async () => [] }));
vi.mock("@/lib/s3", () => ({ publicUrl: () => "" }));
import { GET } from "@/app/api/cleaner/jobs/[id]/briefing/route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({ user: { id: "cleaner" } });
  mocks.job.mockResolvedValue({ id: "current", propertyId: "property", scheduledDate: new Date("2026-09-09T00:00:00Z"), status: "IN_PROGRESS", assignments: [{ responseStatus: "ACCEPTED" }], property: { accessCode: "4729", alarmCode: "9911", keyLocation: "Lockbox", accessNotes: "Side gate" }, laundryTask: null });
  mocks.history.mockResolvedValue([]);
  mocks.laundry.mockResolvedValue(null);
});
async function load() {
  const response = await GET(new Request("http://localhost/api/cleaner/jobs/current/briefing"), { params: { id: "current" } });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  return response;
}
describe("cleaner job briefing read contract", () => {
  it("preserves active ownership and restricts prior-job references to earlier scheduled dates", async () => {
    expect((await load()).status).toBe(200);
    expect(mocks.role).toHaveBeenCalledWith(["CLEANER"]);
    expect(mocks.job).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "current", assignments: { some: { userId: "cleaner", removedAt: null } } } }));
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ propertyId: "property", id: { not: "current" }, scheduledDate: { lt: new Date("2026-09-09T00:00:00Z") } }) }));
  });
  it("does not load historical photos for an unauthorized job", async () => {
    mocks.job.mockResolvedValue(null);
    expect((await load()).status).toBe(404);
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403], ["Database host secret.example failed", 503]])("returns safe private errors for %s", async (message, status) => {
    mocks.role.mockRejectedValue(new Error(message as string));
    const response = await load();
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("secret.example");
  });
  it("handles history-query failure without leaking diagnostics", async () => {
    mocks.history.mockRejectedValue(new Error("secret database details"));
    const response = await load();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret database");
  });

  it("returns access codes only inside the window, with the reason when closed", async () => {
    const open = await (await load()).json();
    expect(open).toMatchObject({ accessWindow: "OPEN", accessCode: "4729", alarmCode: "9911", keyLocation: "Lockbox", accessUnavailableReason: null });

    const base = await mocks.job();
    mocks.job.mockResolvedValue({ ...base, status: "OFFERED", assignments: [{ responseStatus: "PENDING" }] });
    const offered = await (await load()).json();
    expect(offered).toMatchObject({ accessWindow: "NOT_ACCEPTED", accessCode: null, alarmCode: null, keyLocation: null, accessNotes: null });
    expect(offered.accessUnavailableReason).toMatch(/once you accept/);

    // Accepted, finished, and the clean was in September: long past the day after.
    mocks.job.mockResolvedValue({ ...base, status: "COMPLETED" });
    const old = await (await load()).json();
    expect(old).toMatchObject({ accessWindow: "EXPIRED", accessCode: null, alarmCode: null });
  });
});
