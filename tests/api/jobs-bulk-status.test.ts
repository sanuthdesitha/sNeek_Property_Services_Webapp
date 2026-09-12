// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/jobs/bulk-status/route";
import { GET } from "@/app/api/admin/jobs/bulk-status/preview/route";
import { BulkStatusError } from "@/lib/jobs/bulk-status-store";
const m = vi.hoisted(() => ({ identity: vi.fn(), apply: vi.fn(), preview: vi.fn() }));
vi.mock("@/lib/jobs/views-context", () => ({ requireJobsViewsContext: m.identity }));
vi.mock("@/lib/jobs/bulk-status-store", () => ({ applyBulkStatus: m.apply, previewBulkStatus: m.preview, BulkStatusError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
beforeEach(() => { vi.resetAllMocks(); m.identity.mockResolvedValue({ ownerId: "admin", context: "actor", readOnly: false }); m.apply.mockResolvedValue({ ok: true, updated: 1 }); m.preview.mockResolvedValue({ rows: [] }); });
const post = (body: unknown = { jobIds: ["job"], status: "COMPLETED" }, context?: string) => POST(new NextRequest("http://localhost/api/admin/jobs/bulk-status", { method: "POST", headers: context ? { "x-jobs-view-context": context } : {}, body: JSON.stringify(body) }));
const get = (context = "actor", ids = '["job"]') => GET(new NextRequest(`http://localhost/api/admin/jobs/bulk-status/preview?jobIds=${encodeURIComponent(ids)}&status=COMPLETED`, { headers: { "x-jobs-view-context": context } }));
it("preserves legacy mutation contract and private responses", async () => { const result = await post(); expect(result.status).toBe(200); expect(m.apply).toHaveBeenCalledWith("admin", { jobIds: ["job"], status: "COMPLETED" }); expect(result.headers.get("cache-control")).toBe("private, no-store"); });
it("requires correct server context for reviewed mutations and preview", async () => {
  expect((await post({ reviewToken: "a".repeat(64) })).status).toBe(409); expect((await post({}, "other")).status).toBe(409); expect((await get("other")).status).toBe(409); expect(m.apply).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled();
});
it("enforces read-only impersonation while allowing read-only preview", async () => {
  m.identity.mockResolvedValue({ ownerId: "admin", context: "actor", readOnly: true }); expect((await post()).status).toBe(403); expect((await get()).status).toBe(200); expect(m.apply).not.toHaveBeenCalled();
});
it("rejects malformed preview input", async () => { expect((await get("actor", "{")).status).toBe(400); expect(m.preview).not.toHaveBeenCalled(); });
it("passes absent selection for validation instead of inventing jobs", async () => {
  m.preview.mockRejectedValue(new BulkStatusError(400, "Select jobs."));
  const result = await GET(new NextRequest("http://localhost/api/admin/jobs/bulk-status/preview", { headers: { "x-jobs-view-context": "actor" } }));
  expect(result.status).toBe(400); expect(m.preview).toHaveBeenCalledWith({ jobIds: null, status: null });
});
it.each(["UNAUTHORIZED", "FORBIDDEN", "secret connection"])("preserves auth status and masks errors %s", async message => {
  m.identity.mockRejectedValue(new Error(message)); const expected = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 503;
  expect((await post()).status).toBe(expected); const result = await get(); expect(result.status).toBe(expected); expect(JSON.stringify(await result.json())).not.toContain(message);
});
it("returns confirmed rollback conflicts without success", async () => {
  m.apply.mockRejectedValue(new BulkStatusError(409, "Changed since review.")); const result = await post(); expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: "Changed since review." });
});
