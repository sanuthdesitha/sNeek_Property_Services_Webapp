// @vitest-environment node
/**
 * POST /api/admin/onboarding/surveys (2026-11-14): the v2 wizard creates the
 * draft on its first save with an Idempotency-Key. A key this person already
 * used returns that draft instead of a second one; a malformed key is ignored.
 * Live role guard: only ADMIN and OPS_MANAGER may create.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ role: vi.fn(), findFirst: vi.fn(), create: vi.fn(), number: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { propertyOnboardingSurvey: { findFirst: m.findFirst, create: m.create } } }));
vi.mock("@/lib/onboarding/survey-number", () => ({ generateSurveyNumber: m.number }));

import { POST } from "@/app/api/admin/onboarding/surveys/route";

const KEY = "onb-1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
function request(body: unknown, key?: string) {
  return new NextRequest("http://localhost/api/admin/onboarding/surveys", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  m.number.mockResolvedValue("ONB-0042");
  m.findFirst.mockResolvedValue(null);
  m.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "survey-new", ...args.data }));
});

describe("onboarding survey create", () => {
  it("creates once and keeps the key beside the form meta", async () => {
    const response = await POST(request({ isNewClient: true, clientData: { name: "Harbour View" }, selectedJobTypes: ["AIRBNB_TURNOVER"] }, KEY));
    expect(response.status).toBe(201);
    expect(m.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { submittedById: "admin-1", adminOverrides: { path: ["draftCreateKey"], equals: KEY } },
    }));
    const data = m.create.mock.calls[0][0].data;
    expect(data.adminOverrides).toEqual({ formMeta: { selectedJobTypes: ["AIRBNB_TURNOVER"] }, draftCreateKey: KEY });
    expect(data.submittedById).toBe("admin-1");
  });

  it("a retry with the same key returns the draft already made, without a second survey", async () => {
    m.findFirst.mockResolvedValue({ id: "survey-existing", status: "DRAFT" });
    const response = await POST(request({ isNewClient: true, clientData: { name: "Harbour View" } }, KEY));
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe("survey-existing");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.number).not.toHaveBeenCalled();
  });

  it("ignores a missing or malformed key (older callers keep working)", async () => {
    expect((await POST(request({ propertyName: "Loft" }))).status).toBe(201);
    expect((await POST(request({ propertyName: "Loft" }, "bad key!"))).status).toBe(201);
    expect(m.findFirst).not.toHaveBeenCalled();
    for (const call of m.create.mock.calls) expect(call[0].data.adminOverrides).not.toHaveProperty("draftCreateKey");
  });

  it("refuses people outside the live role guard", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await POST(request({ propertyName: "Loft" }, KEY))).status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });
});
