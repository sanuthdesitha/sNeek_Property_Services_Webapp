// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findMany: vi.fn(),
  loadAccountRows: vi.fn(),
  resolveViewer: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({ db: { user: { findMany: m.findMany } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn(async () => ({ profileEditOverrides: {} })), setProfileOverrideForUser: vi.fn() }));
vi.mock("@/lib/accounts/user-details", () => ({ getUserExtendedProfiles: vi.fn(async () => new Map()), upsertUserExtendedProfile: vi.fn() }));
vi.mock("@/lib/accounts/list/service", () => ({ loadAccountRows: m.loadAccountRows }));
vi.mock("@/lib/accounts/viewer", () => ({ resolveAccountsViewer: m.resolveViewer }));

import { GET } from "@/app/api/admin/users/route";
import { GET as EXPORT } from "@/app/api/admin/users/export/route";

const row = (id: string, name: string, rate: number | null) => ({
  id, name, email: `${id}@example.com`, phone: null, role: "CLEANER", extraRoles: [], status: "ACTIVE", inviteAgeDays: null,
  emailVerified: true, twoFactorEnabled: false, clientName: null, rate, jobs30: 3, qa30: null,
  documents: { kind: "NONE", label: "None on file" }, lastSeenAt: null, attention: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "admin", role: "ADMIN", heldRoles: ["ADMIN"] } });
  m.resolveViewer.mockResolvedValue({ id: "admin", isAdmin: true, canWriteNotes: true, canUploadDocuments: true, visibility: { pay: true, quality: true } });
  m.loadAccountRows.mockResolvedValue([row("a", "Aiko", 34), row("b", "Bea", null), row("c", "Cal", 30)]);
  m.findMany.mockResolvedValue([{ id: "u1", name: "A", email: "a@x", role: "CLEANER", vaTeam: null, notificationPreference: null }]);
});

describe("GET /api/admin/users", () => {
  it("keeps the plain array for every existing caller", async () => {
    const res = await GET(new NextRequest("http://localhost/api/admin/users?role=CLEANER"));
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ id: "u1", profileEditOverride: null, extendedProfile: null });
    expect(m.loadAccountRows).not.toHaveBeenCalled();
    expect(m.findMany.mock.calls[0][0].where).toEqual({ isActive: true, role: "CLEANER" });
  });

  it("answers the paginated list shape with ?paginated=1", async () => {
    const res = await GET(new NextRequest("http://localhost/api/admin/users?paginated=1&sort=rate&dir=desc&pageSize=2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 3, page: 1, pageSize: 2, pageCount: 2, sort: "rate", dir: "desc", tab: "everyone" });
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(["a", "c"]);
    expect(body.counts.everyone).toBe(3);
    expect(body.columns).toEqual({ pay: true, quality: true });
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it("refuses an unknown sort with 400", async () => {
    const res = await GET(new NextRequest("http://localhost/api/admin/users?paginated=1&sort=passwordHash"));
    expect(res.status).toBe(400);
  });

  it("refuses sorting by pay when the viewer may not see pay", async () => {
    m.resolveViewer.mockResolvedValue({ id: "ops", isAdmin: false, canWriteNotes: true, canUploadDocuments: false, visibility: { pay: false, quality: true } });
    const res = await GET(new NextRequest("http://localhost/api/admin/users?paginated=1&sort=rate"));
    expect(res.status).toBe(400);
  });

  it("is limited to office roles", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await GET(new NextRequest("http://localhost/api/admin/users?paginated=1"))).status).toBe(403);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  });
});

describe("GET /api/admin/users/export", () => {
  it("exports the filtered, sorted list as CSV without hidden columns", async () => {
    m.resolveViewer.mockResolvedValue({ id: "ops", isAdmin: false, canWriteNotes: true, canUploadDocuments: false, visibility: { pay: false, quality: false } });
    m.loadAccountRows.mockResolvedValue([{ ...row("a", "Aiko", 34), rate: undefined, jobs30: undefined, qa30: undefined }]);
    const res = await EXPORT(new NextRequest("http://localhost/api/admin/users/export?tab=cleaners"));
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("Aiko");
    expect(text).not.toContain("Hourly rate");
    expect(text).not.toContain("QA, 30 d");
  });
});
