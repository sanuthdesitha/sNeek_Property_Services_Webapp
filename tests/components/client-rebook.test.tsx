import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ClientBookingPage from "@/app/v2/client/booking/page";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), properties: vi.fn(), source: vi.fn(), flow: vi.fn(), scope: vi.fn() }));
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortalPage: mocks.auth, propertyScopeWhere: mocks.scope }));
vi.mock("@/lib/db", () => ({ db: { property: { findMany: mocks.properties }, job: { findFirst: mocks.source } } }));
vi.mock("@/components/v2/client/booking-flow", () => ({ EstateBookingFlow: (props: unknown) => { mocks.flow(props); return <div>Current booking flow</div>; } }));
const property = { id: "p1", name: "Harbour", suburb: "Sydney", bedrooms: 2, bathrooms: 1, client: { name: "Current client" } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ actor: "CLIENT", userId: "client-user", clientId: "c1", propertyIds: null, actorLabel: "Client" });
  mocks.scope.mockReturnValue({ clientId: "c1" });
  mocks.properties.mockResolvedValue([property]);
  mocks.source.mockResolvedValue({ propertyId: "p1", jobType: "DEEP_CLEAN", status: "COMPLETED", isRework: false });
});
describe("authorized rebook page", () => {
  it.each(["CLIENT", "VA"])("resolves %s scope and seeds only property/service under a separate draft key", async (actor) => {
    mocks.auth.mockResolvedValue({ actor, userId: "actor-1", clientId: "c1", propertyIds: ["p1"], actorLabel: actor });
    mocks.scope.mockReturnValue({ clientId: "c1", id: { in: ["p1"] } });
    const view = render(await ClientBookingPage({ searchParams: { rebook: "old-job" } }));
    expect(mocks.auth).toHaveBeenCalledWith({ module: "booking", permission: "bookings" });
    expect(mocks.source).toHaveBeenCalledWith({ where: { id: "old-job", property: { clientId: "c1", id: { in: ["p1"] }, isActive: true }, isRework: false }, select: { propertyId: true, jobType: true, status: true, isRework: true } });
    expect(mocks.flow.mock.calls[0][0].rebook).toEqual({ propertyId: "p1", jobType: "DEEP_CLEAN" });
    const rebookScope = mocks.flow.mock.calls[0][0].draftScope;
    view.rerender(await ClientBookingPage({}));
    expect(mocks.flow.mock.calls.at(-1)![0].draftScope).not.toBe(rebookScope);
    expect(mocks.flow.mock.calls.at(-1)![0].rebook).toBeUndefined();
  });
  it.each(["missing", "inactive", "scope-changed", "unsupported", "rework"])("does not seed a %s source", async (scenario) => {
    if (scenario === "missing" || scenario === "inactive") mocks.source.mockResolvedValue(null);
    if (scenario === "scope-changed") mocks.properties.mockResolvedValue([{ ...property, id: "different" }]);
    if (scenario === "unsupported") mocks.source.mockResolvedValue({ propertyId: "p1", jobType: "MAINTENANCE", status: "COMPLETED" });
    if (scenario === "rework") mocks.source.mockResolvedValue({ propertyId: "p1", jobType: "GENERAL_CLEAN", status: "COMPLETED", isRework: true });
    render(await ClientBookingPage({ searchParams: { rebook: "old-job" } }));
    expect(screen.getByText("This clean cannot be rebooked")).toBeVisible();
    expect(mocks.flow).not.toHaveBeenCalled();
  });
  it("does not look up source jobs when booking permission/module authorization fails", async () => {
    mocks.auth.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(ClientBookingPage({ searchParams: { rebook: "old-job" } })).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.properties).not.toHaveBeenCalled();
  });
  it("reports failed source retrieval separately from an unavailable property", async () => {
    mocks.source.mockRejectedValue(new Error("offline"));
    render(await ClientBookingPage({ searchParams: { rebook: "old-job" } }));
    expect(screen.getByText("Previous clean unavailable")).toBeVisible();
    expect(screen.getByRole("link", { name: "Retry previous clean" })).toHaveAttribute("href", "/v2/client/booking?rebook=old-job");
    expect(mocks.flow).not.toHaveBeenCalled();
  });
});
