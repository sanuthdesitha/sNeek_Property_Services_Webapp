// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  job: vi.fn(),
  report: vi.fn(),
  notice: vi.fn(),
  generate: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({
  db: {
    report: { update: m.update, delete: m.remove, findUnique: m.report },
    job: { findUnique: m.job },
    notification: { create: m.notice },
  },
}));
vi.mock("@/lib/reports/generator", () => ({ generateJobReport: m.generate }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));

import { POST } from "@/app/api/admin/reports/bulk/route";
import { MAX_BULK_REGENERATE } from "@/lib/reports/report-bulk-limits";

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/admin/reports/bulk", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  m.settings.mockResolvedValue({ strictClientAdminOnly: false });
  m.report.mockResolvedValue({ pdfUrl: "x" });
});

describe("reports bulk endpoint", () => {
  it("uses the report guard and refuses before touching anything", async () => {
    m.auth.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await post({ action: "delete", jobIds: ["a"], confirm: true })).status).toBe(403);
    expect(m.remove).not.toHaveBeenCalled();
    m.auth.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await post({ action: "delete", jobIds: ["a"], confirm: true })).status).toBe(401);
  });

  it("sets laundry visibility per row, attributing the actor, with one outcome per row", async () => {
    m.update.mockImplementation(async ({ where }: { where: { jobId: string } }) => {
      if (where.jobId === "missing") throw Object.assign(new Error("No record"), { code: "P2025" });
      return {};
    });
    const response = await post({ action: "visibility", jobIds: ["a", "missing", "b", "a"], patch: { laundryVisible: true } });
    expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    const body = await response.json();
    expect(body).toMatchObject({ action: "visibility", succeeded: 2, failed: 1 });
    expect(body.results).toEqual([
      { jobId: "a", ok: true },
      { jobId: "missing", ok: false, status: 404, error: "Report not found" },
      { jobId: "b", ok: true },
    ]);
    expect(m.update.mock.calls[0][0].data).toMatchObject({ laundryVisible: true, visibilityUpdatedById: "admin-1" });
    expect(m.update.mock.calls[0][0].data.clientVisible).toBeUndefined();
  });

  it("regenerates each row with the chosen theme and reports a missing job without stopping", async () => {
    m.job.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "gone" ? null : { id: where.id }));
    const body = await (await post({ action: "regenerate", jobIds: ["a", "gone"], themeId: "theme-1" })).json();
    expect(m.generate).toHaveBeenCalledWith("a", "theme-1");
    expect(m.generate).toHaveBeenCalledTimes(1);
    expect(body.results[1]).toEqual({ jobId: "gone", ok: false, status: 404, error: "Job not found" });
  });

  it("refuses delete without the confirmation flag, and refuses too many regenerations", async () => {
    expect((await post({ action: "delete", jobIds: ["a"] })).status).toBe(400);
    expect(m.remove).not.toHaveBeenCalled();
    const ids = Array.from({ length: MAX_BULK_REGENERATE + 1 }, (_, i) => `j${i}`);
    expect((await post({ action: "regenerate", jobIds: ids })).status).toBe(400);
    expect((await post({ action: "visibility", jobIds: ["a"], patch: {} })).status).toBe(400);
  });

  it("deletes confirmed rows and keeps going after a failure", async () => {
    m.remove.mockRejectedValueOnce(new Error("locked")).mockResolvedValueOnce({});
    const body = await (await post({ action: "delete", jobIds: ["a", "b"], confirm: true })).json();
    expect(body.results).toEqual([
      { jobId: "a", ok: false, status: 400, error: "locked" },
      { jobId: "b", ok: true },
    ]);
  });
});
