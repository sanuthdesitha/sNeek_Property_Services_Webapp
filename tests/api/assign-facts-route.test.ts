// @vitest-environment node
/**
 * GET /api/admin/jobs/assign-facts (2026-11): read only; the same live role
 * guard as the assign routes; bounded input; a missing job is 404, not an
 * empty "no warnings" answer.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/jobs/assign-facts-load", () => ({ loadAssignFacts: m.load }));
import { GET } from "@/app/api/admin/jobs/assign-facts/route";

const get = (query: string) => GET(new NextRequest(`http://localhost/api/admin/jobs/assign-facts${query}`));
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "admin" } }); });

it("answers the loader's facts for admins and operations managers", async () => {
  m.load.mockResolvedValue({ jobs: [{ id: "j1", dayKey: "2026-11-21" }], cleaners: [{ userId: "u1", otherJobsThatDay: 0, warnings: [{ kind: "leave", jobId: "j1", text: "On leave 19–23 Nov" }] }] });
  const response = await get("?jobIds=j1,j2");
  expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  expect(m.load).toHaveBeenCalledWith(["j1", "j2"]);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

it.each(["", "?jobIds=", `?jobIds=${Array.from({ length: 201 }, (_, i) => `j${i}`).join(",")}`])("refuses %s without reading", async (query) => {
  expect((await get(query)).status).toBe(400);
  expect(m.load).not.toHaveBeenCalled();
});

it("a job that does not exist is 404, never an empty answer", async () => {
  m.load.mockResolvedValue(null);
  expect((await get("?jobIds=gone")).status).toBe(404);
});

it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]])("%s never reaches the loader", async (message, status) => {
  m.auth.mockRejectedValue(new Error(String(message)));
  expect((await get("?jobIds=j1")).status).toBe(status);
  expect(m.load).not.toHaveBeenCalled();
});
