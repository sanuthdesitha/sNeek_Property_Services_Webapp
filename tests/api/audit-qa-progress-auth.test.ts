// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), assignment: vi.fn(), job: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.job }, qaAssignment: { findFirst: m.assignment } } }));
import { GET } from "@/app/api/qa/jobs/[id]/progress/route";
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "inspector", role: "CLEANER", heldRoles: ["CLEANER", "QA_INSPECTOR"] } }); m.job.mockResolvedValue(null); });
it("rejects unassigned inspectors before loading private clean progress even under another active hat", async () => {
  expect((await GET(new NextRequest("http://local"), { params: { id: "other" } })).status).toBe(403);
  expect(m.job).not.toHaveBeenCalled();
});
it("permits assigned inspectors and privileged office roles to reach job lookup", async () => {
  m.assignment.mockResolvedValue({ id: "own" });
  expect((await GET(new NextRequest("http://local"), { params: { id: "own" } })).status).toBe(404);
  m.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } }); m.assignment.mockResolvedValue(null);
  expect((await GET(new NextRequest("http://local"), { params: { id: "any" } })).status).toBe(404);
});
