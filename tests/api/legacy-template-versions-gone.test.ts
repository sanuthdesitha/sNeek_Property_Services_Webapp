// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({ session: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({
  db: {
    formTemplate: { findUnique: m.findUnique, findMany: m.findMany, update: m.update, updateMany: m.updateMany, create: m.create },
    $transaction: m.transaction,
  },
}));

import { GET, POST as CREATE } from "@/app/api/admin/phase4/template-versions/[templateId]/route";
import { POST as ROLLBACK } from "@/app/api/admin/phase4/template-versions/[templateId]/rollback/route";

const params = { params: { templateId: "t1" } };

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN } });
});

describe("old template-versions API", () => {
  it("rollback refuses with 410, points to the Forms library and changes nothing", async () => {
    const response = await ROLLBACK();
    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.error).toContain("/api/admin/form-templates/{id}/versions/{versionId}/restore");
    expect(m.update).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("creating a sibling version refuses with 410 and switches no active form", async () => {
    const response = await CREATE();
    expect(response.status).toBe(410);
    expect(m.create).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("still answers auth errors with 401 / 403 before anything else", async () => {
    m.session.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await ROLLBACK()).status).toBe(403);
    m.session.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await CREATE()).status).toBe(401);
  });

  it("keeps the read route", async () => {
    m.findUnique.mockResolvedValue({ id: "t1", name: "Turnover v2", serviceType: "AIRBNB_TURNOVER" });
    m.findMany.mockResolvedValue([{ id: "t1", name: "Turnover v2", version: 2 }, { id: "t0", name: "Turnover", version: 1 }]);
    const response = await GET(new NextRequest("http://localhost/x"), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ baseName: "Turnover", templates: [{ id: "t1" }, { id: "t0" }] });
    expect(m.session).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  });
});
