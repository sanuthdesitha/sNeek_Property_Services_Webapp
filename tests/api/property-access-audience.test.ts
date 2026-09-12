// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: vi.fn(), property: vi.fn(), assignment: vi.fn(), laundry: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/db", () => ({ db: { property: { findUnique: mocks.property }, job: { findFirst: mocks.assignment } } }));
vi.mock("@/lib/laundry/teams", () => ({ propertyIsVisibleToLaundry: mocks.laundry }));
import { GET } from "@/app/api/cleaner/property-access/[propertyId]/route";
const entry = (id: string, audience?: string) => ({ id, kind: "ENTRY", label: id, instructions: `Private ${id}`, audience, images: [{ url: `https://example.test/${id}.png`, key: `secret-${id}` }] });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({ user: { id: "reader", role: "CLEANER" } });
  mocks.assignment.mockResolvedValue({ id: "job" });
  mocks.laundry.mockReturnValue(true);
  mocks.property.mockResolvedValue({ id: "property", laundryEnabled: true, accessInfo: {}, accessGuide: [entry("cleaner", "CLEANER"), entry("laundry", "LAUNDRY"), entry("shared", "BOTH"), entry("legacy"), entry("unknown", "INVALID")] });
});
async function load() {
  const response = await GET(new Request("http://localhost/api/cleaner/property-access/property"), { params: { propertyId: "property" } });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  return response;
}
describe("property access audience projection", () => {
  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403], ["Database host secret.example failed", 503]])("returns private safe errors for %s", async (message, status) => {
    mocks.role.mockRejectedValue(new Error(message as string));
    const response = await load();
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("secret.example");
  });
  it("keeps missing-property responses private", async () => {
    mocks.property.mockResolvedValue(null);
    expect((await load()).status).toBe(404);
  });
  it.each([
    ["CLEANER", false, ["cleaner", "shared", "legacy"]],
    ["LAUNDRY", false, ["laundry", "shared", "legacy"]],
    ["LAUNDRY", true, ["cleaner", "laundry", "shared", "legacy"]],
  ])("filters %s before sanitization with same-as-cleaner %s", async (role, same, ids) => {
    mocks.role.mockResolvedValue({ user: { id: "reader", role } });
    const property = await mocks.property();
    property.accessInfo = { laundrySameAsCleaner: same };
    const response = await load();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accessGuide.map((item: { id: string }) => item.id)).toEqual(ids);
    expect(JSON.stringify(body)).not.toContain("secret-");
    expect(JSON.stringify(body)).not.toContain("unknown");
    if (role === "CLEANER") expect(JSON.stringify(body.accessGuide)).not.toContain("laundry");
  });
  it("still denies cleaners without a nonremoved property assignment", async () => {
    mocks.assignment.mockResolvedValue(null);
    expect((await load()).status).toBe(403);
    expect(mocks.assignment).toHaveBeenCalledWith(expect.objectContaining({ where: { propertyId: "property", assignments: { some: { userId: "reader", removedAt: null } } } }));
  });
  it("still denies laundry readers outside the property team", async () => {
    mocks.role.mockResolvedValue({ user: { id: "reader", role: "LAUNDRY" } });
    mocks.laundry.mockReturnValue(false);
    expect((await load()).status).toBe(403);
  });
});
