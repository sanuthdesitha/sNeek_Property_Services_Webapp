// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  session: vi.fn(),
  user: vi.fn(),
  policy: vi.fn(),
  jobs: vi.fn(),
  count: vi.fn(),
  role: "ADMIN",
}));
vi.mock("next-auth", () => ({ getServerSession: m.session }));
vi.mock("@/lib/auth/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/auth/active-role", () => ({
  readActiveRoleCookie: () => m.role,
}));
vi.mock("@/lib/auth/impersonation-server", () => ({
  resolveImpersonation: async () => null,
}));
vi.mock("next/headers", () => ({
  headers: () =>
    new Headers({
      "x-sneek-request-path": "/api/jobs?paginated=1",
      "x-sneek-request-method": "GET",
    }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: m.user },
    appSetting: { findUnique: m.policy },
    job: { findMany: m.jobs, count: m.count },
  },
}));
import { GET } from "@/app/api/jobs/route";
const request = () =>
  new NextRequest("http://local/api/jobs?paginated=1&page=1&limit=50");
beforeEach(() => {
  vi.resetAllMocks();
  m.role = "ADMIN";
  m.session.mockResolvedValue({ user: { id: "owner", role: "ADMIN" } });
  m.user.mockResolvedValue({
    id: "owner",
    role: "ADMIN",
    isActive: true,
    extraRoles: [],
  });
  m.jobs.mockResolvedValue([]);
  m.count.mockResolvedValue(0);
  m.policy.mockResolvedValue(null);
});
it("reads live owner permissions and returns the paginated contract without a public-host callback", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    jobs: [],
    pagination: { page: 1, limit: 50, totalCount: 0, totalPages: 1 },
  });
  expect(m.user).toHaveBeenCalled();
  expect(m.policy).not.toHaveBeenCalled();
});
it.each([
  null,
  { id: "owner", role: "ADMIN", isActive: false, extraRoles: [] },
])("rejects a revoked owner %j before reading jobs", async (user) => {
  m.user.mockResolvedValue(user);
  expect((await GET(request())).status).toBe(401);
  expect(m.jobs).not.toHaveBeenCalled();
});
it("enforces live OPS restrictions even when the session previously claimed ADMIN", async () => {
  m.role = "OPS_MANAGER";
  m.user.mockResolvedValue({
    id: "owner",
    role: "OPS_MANAGER",
    isActive: true,
    extraRoles: [],
  });
  m.policy.mockResolvedValue({
    value: {
      revision: 1,
      presets: [],
      assignments: {
        owner: { presetId: "observer", overrides: { jobs: "off" } },
      },
    },
  });
  expect((await GET(request())).status).toBe(403);
  expect(m.jobs).not.toHaveBeenCalled();
});
it("continues scoping a cleaner to their own assignments", async () => {
  m.role = "CLEANER";
  m.user.mockResolvedValue({
    id: "owner",
    role: "CLEANER",
    isActive: true,
    extraRoles: [],
  });
  expect((await GET(request())).status).toBe(200);
  expect(m.jobs).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        assignments: { some: { userId: "owner", removedAt: null } },
      }),
    }),
  );
});
