// @vitest-environment node
// Wave B: the "Reject submissions that break these checks" switch is ADMIN
// only, audited, and its counts are "–" (null) when they cannot be read.
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), settings: vi.fn(), save: vi.fn(), audit: vi.fn(), stats: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings, saveAppSettings: m.save }));
vi.mock("@/lib/db", () => ({ db: { auditLog: { create: m.audit } } }));
vi.mock("@/lib/forms/validation-warning-stats", () => ({ loadValidationWarningStats: m.stats }));
import { GET, PUT } from "@/app/api/admin/form-templates/validation-setting/route";

const put = (body: unknown) => PUT(new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.settings.mockResolvedValue({});
});

it("switching on is ADMIN only, stamps the moment and is audited", async () => {
  const response = await put({ enforce: true });
  expect(response.status).toBe(200);
  expect(m.role).toHaveBeenCalledWith(["ADMIN"]);
  const saved = m.save.mock.calls[0][0].formValidation;
  expect(saved.enforceExtended).toBe(true);
  expect(Date.parse(saved.enforcedSince)).toBeGreaterThan(0);
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "FORM_VALIDATION_ENFORCEMENT", userId: "admin" }) }));
});

it("refuses an operations manager", async () => {
  m.role.mockRejectedValue(new Error("FORBIDDEN"));
  expect((await put({ enforce: true })).status).toBe(403);
  expect(m.save).not.toHaveBeenCalled();
});

it("reports unreadable counts as unavailable, never zero", async () => {
  m.stats.mockRejectedValue(new Error("db down"));
  const body = await (await GET()).json();
  expect(body.stats).toBeNull();
  expect(body.statsError).toMatch(/could not be read/);
  expect(body.setting).toEqual({ enforceExtended: false, enforcedSince: null });
  expect(body.rules).toContain("range");
});
