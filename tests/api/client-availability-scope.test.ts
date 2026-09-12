// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/client/available-slots/route";

const mocks = vi.hoisted(() => ({ portal: vi.fn(), property: vi.fn(), jobs: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortal: mocks.portal }));
vi.mock("@/lib/portal-access", () => ({ isClientModuleEnabled: mocks.enabled }));
vi.mock("@/lib/db", () => ({ db: { property: { findFirst: mocks.property }, job: { findMany: mocks.jobs } } }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.portal.mockResolvedValue({ actor: "VA", clientId: "client-one", propertyIds: ["allowed"], visibility: {} });
  mocks.enabled.mockReturnValue(true);
  mocks.property.mockImplementation(async ({ where }) => {
    const scope = where.AND?.[0]?.id?.in;
    return where.clientId === "client-one" && where.isActive &&
      ["allowed", "other"].includes(where.id) && (!scope || scope.includes(where.id)) ? { id: where.id } : null;
  });
  mocks.jobs.mockResolvedValue([]);
});

const request = (propertyId = "allowed") => new NextRequest(`http://localhost/api/client/available-slots?propertyId=${propertyId}&serviceType=GENERAL_CLEAN`);

describe("booking availability property scope", () => {
  it("intersects the requested property with client ownership and the VA grant", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.portal).toHaveBeenCalledWith({ permission: "bookings" });
    expect(mocks.property).toHaveBeenCalledWith({ where: {
      id: "allowed", clientId: "client-one", isActive: true, AND: [{ id: { in: ["allowed"] } }],
    }, select: { id: true } });
    const body = await response.json();
    expect(body.available).toHaveLength(30);
    expect(body.available[0]).toBe(body.windowStart);
    expect(body.available[29]).toBe(body.windowEnd);
  });
  it("refuses a same-client property outside the VA scope before reading capacity", async () => {
    expect((await GET(request("other"))).status).toBe(404);
    expect(mocks.jobs).not.toHaveBeenCalled();
  });
  it("treats an explicit empty scope as no access, not unrestricted", async () => {
    mocks.portal.mockResolvedValue({ actor: "VA", clientId: "client-one", propertyIds: [], visibility: {} });
    expect((await GET(request())).status).toBe(404);
    expect(mocks.jobs).not.toHaveBeenCalled();
  });
  it.each(["CLIENT", "VA"])("preserves unrestricted client-property scope for %s", async (actor) => {
    mocks.portal.mockResolvedValue({ actor, clientId: "client-one", propertyIds: null, visibility: {} });
    expect((await GET(request("other"))).status).toBe(200);
    expect(mocks.property.mock.calls[0][0].where).toEqual({ id: "other", clientId: "client-one", isActive: true });
  });
  it.each(["UNAUTHORIZED", "FORBIDDEN"])("refuses %s before property or capacity reads", async (error) => {
    mocks.portal.mockRejectedValue(new Error(error));
    expect((await GET(request())).status).toBe(error === "UNAUTHORIZED" ? 401 : 403);
    expect(mocks.property).not.toHaveBeenCalled();
    expect(mocks.jobs).not.toHaveBeenCalled();
  });
  it("respects the booking visibility gate", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.property).not.toHaveBeenCalled();
  });
  it("does not turn a property read failure into available dates", async () => {
    mocks.property.mockRejectedValue(new Error("Unavailable"));
    const response = await GET(request());
    expect(response.ok).toBe(false);
    expect(await response.json()).not.toHaveProperty("available");
    expect(mocks.jobs).not.toHaveBeenCalled();
  });
});
