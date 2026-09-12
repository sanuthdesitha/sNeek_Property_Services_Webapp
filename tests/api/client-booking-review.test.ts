// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), user: vi.fn(), settings: vi.fn(), settingRow: vi.fn(), property: vi.fn(), quote: vi.fn(),
  defaults: { clientPortalVisibility: { showBooking: true, showFinanceDetails: true } },
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/settings", () => ({ DEFAULT_SETTINGS: mocks.defaults, getAppSettings: mocks.settings }));
vi.mock("@/lib/db", () => ({ db: {
  user: { findUnique: mocks.user }, appSetting: { findUnique: mocks.settingRow }, property: { findFirst: mocks.property },
} }));
vi.mock("@/lib/pricing/calculator", () => ({ calculateQuote: mocks.quote }));

import { GET } from "@/app/api/client/booking-review/route";

const property = {
  bedrooms: 3, bathrooms: 2, defaultCheckinTime: "14:00", defaultCheckoutTime: "10:00", jobTimeSource: "PROPERTY",
  accessCode: null, keyLocation: null, accessNotes: null, accessGuide: null, accessInfo: null,
};

function actor(role: Role = Role.CLIENT, scope: unknown = ["property-1"], permissions: unknown = { bookings: true, invoicesView: true }) {
  mocks.session.mockResolvedValue({ user: { id: "actor", role } });
  mocks.user.mockResolvedValue({
    id: "actor", name: "Actor", clientId: "client-1", client: { portalVisibilityOverrides: null },
    vaTeam: role === Role.VA ? {
      id: "team", name: "Team", isActive: true, clientId: "team-client", propertyIds: scope, permissions,
      client: { name: "Client", portalVisibilityOverrides: null },
    } : null,
  });
}

async function request(query = "propertyId=property-1&serviceType=GENERAL_CLEAN") {
  const response = await GET(new Request(`http://localhost/api/client/booking-review?${query}`));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  return response;
}

beforeEach(() => {
  vi.resetAllMocks();
  actor();
  mocks.settings.mockImplementation(async () => structuredClone(mocks.defaults));
  mocks.settingRow.mockResolvedValue(null);
  mocks.property.mockResolvedValue({ ...property });
  mocks.quote.mockResolvedValue({ total: 220, gst: 20, provider: "secret-provider", lineItems: [{ secret: "internal" }] });
});

describe("booking review authorization and boundaries", () => {
  it("returns only the review contract with booking POST quote inputs", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      propertyId: "property-1", serviceType: "GENERAL_CLEAN", pricing: { state: "estimate", total: 220, gst: 20 },
      timing: { checkin: "14:00", checkout: "10:00", source: "PROPERTY" }, access: { recorded: false },
    });
    expect(mocks.quote).toHaveBeenCalledTimes(1);
    expect(mocks.quote).toHaveBeenCalledWith({ serviceType: "GENERAL_CLEAN", bedrooms: 3, bathrooms: 2 });
    expect(mocks.property.mock.lastCall![0].where).toEqual({ id: "property-1", clientId: "client-1", isActive: true });
    expect(mocks.settings).toHaveBeenCalledTimes(1);
  });

  it.each([null, [], ["property-1"], ["other"]].map(scope => ({ scope })))("ANDs exact requested property with VA scope $scope", async ({ scope }) => {
    actor(Role.VA, scope);
    mocks.property.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.property.mock.lastCall![0].where).toEqual({
      id: "property-1", clientId: "team-client", isActive: true,
      ...(scope?.length ? { AND: [{ id: { in: scope } }] } : {}),
    });
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403], ["database password internal", 503]])("maps %s safely", async (error, status) => {
    mocks.session.mockRejectedValue(new Error(String(error)));
    const response = await request();
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("database password internal");
    expect(mocks.property).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it.each([Role.ADMIN, Role.CLEANER])("denies role %s", async role => {
    actor(role);
    expect((await request()).status).toBe(403);
    expect(mocks.property).not.toHaveBeenCalled();
  });

  it("denies VA booking permission and inactive teams", async () => {
    actor(Role.VA, null, { invoicesView: true });
    expect((await request()).status).toBe(403);
    actor(Role.VA);
    const user = await mocks.user();
    mocks.user.mockResolvedValue({ ...user, vaTeam: { ...user.vaTeam, isActive: false } });
    expect((await request()).status).toBe(403);
    expect(mocks.property).not.toHaveBeenCalled();
  });

  it("denies the merged booking visibility override", async () => {
    const user = await mocks.user();
    mocks.user.mockResolvedValue({ ...user, client: { portalVisibilityOverrides: { showBooking: false } } });
    expect((await request()).status).toBe(403);
    expect(mocks.property).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing client profile", async () => {
    mocks.user.mockResolvedValue({ id: "actor", clientId: null });
    expect((await request()).status).toBe(404);
    expect(mocks.property).not.toHaveBeenCalled();
  });

  it.each(["settings", "settingRow", "property"] as const)("fails closed on %s read errors", async key => {
    if (key === "settingRow") mocks.settings.mockResolvedValue(mocks.defaults);
    mocks[key].mockRejectedValue(new Error("sensitive database details"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Booking review unavailable." });
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it("rejects settings fallback when a persisted row exists", async () => {
    mocks.settings.mockResolvedValue(mocks.defaults);
    mocks.settingRow.mockResolvedValue({ key: "app" });
    expect((await request()).status).toBe(503);
    expect(mocks.property).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it("accepts defaults when there is genuinely no settings row", async () => {
    mocks.settings.mockResolvedValue(mocks.defaults);
    expect((await request()).status).toBe(200);
    expect(mocks.settingRow).toHaveBeenCalledWith({ where: { key: "app" }, select: { key: true } });
  });

  it.each(["GENERAL_CLEAN", "DEEP_CLEAN", "END_OF_LEASE", "AIRBNB_TURNOVER", "SPRING_CLEANING"])("accepts %s", async service => {
    expect((await request(`propertyId=property-1&serviceType=${service}`)).status).toBe(200);
    expect(mocks.quote.mock.lastCall![0].serviceType).toBe(service);
  });

  it.each([
    "", "propertyId=property-1", "serviceType=GENERAL_CLEAN", "propertyId=%20&serviceType=GENERAL_CLEAN",
    `propertyId=${"a".repeat(129)}&serviceType=GENERAL_CLEAN`, "propertyId=a%00&serviceType=GENERAL_CLEAN",
    "propertyId=../a&serviceType=GENERAL_CLEAN", "propertyId=a&serviceType=WINDOW_CLEAN",
    "propertyId=a&serviceType=SPRING_CLEAN", "propertyId=a&serviceType=general_clean",
    "propertyId=a&propertyId=b&serviceType=GENERAL_CLEAN", "propertyId=a&serviceType=GENERAL_CLEAN&serviceType=DEEP_CLEAN",
  ])("rejects invalid query %s before property reads", async query => {
    expect((await request(query)).status).toBe(400);
    expect(mocks.property).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
  });
});

describe("booking review pricing", () => {
  it.each(["module", "permission", "override"])("hides finance for %s and never calculates", async kind => {
    if (kind === "module") mocks.settings.mockResolvedValue({ clientPortalVisibility: { showBooking: true, showFinanceDetails: false } });
    if (kind === "permission") actor(Role.VA, null, { bookings: true });
    if (kind === "override") {
      const user = await mocks.user();
      mocks.user.mockResolvedValue({ ...user, client: { portalVisibilityOverrides: { showFinanceDetails: false } } });
    }
    expect((await (await request()).json()).pricing).toEqual({ state: "hidden" });
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -Infinity, -1, "220", null, undefined])("rejects invalid amount %s", async value => {
    for (const field of ["total", "gst"]) {
      mocks.quote.mockResolvedValue({ total: 220, gst: 20, [field]: value });
      expect((await (await request()).json()).pricing).toEqual({ state: "unavailable" });
    }
  });

  it("accepts zero amounts", async () => {
    mocks.quote.mockResolvedValue({ total: 0, gst: 0 });
    expect((await (await request()).json()).pricing).toEqual({ state: "estimate", total: 0, gst: 0 });
  });

  it("keeps timing and access available when calculation fails", async () => {
    mocks.quote.mockRejectedValue(new Error("provider credentials"));
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pricing: { state: "unavailable" }, access: { recorded: false }, timing: { checkin: "14:00" } });
  });
});

describe("booking review access and timing", () => {
  it.each([
    { accessCode: "secret-code" }, { keyLocation: "secret-location" }, { accessNotes: "secret-notes" },
    { accessGuide: [{ instructions: "secret-instructions" }] }, { accessGuide: [{ images: [{ url: "secret-image" }] }] },
    { accessGuide: [{ locationNote: "secret-location" }] },
    { accessInfo: { codes: "secret-code" } }, { accessInfo: { lockbox: "secret-lockbox" } },
    { accessInfo: { instructions: "secret-instructions" } }, { accessInfo: { attachments: [{ url: "secret-file" }] } },
  ])("returns only a boolean for recorded access %j", async fields => {
    mocks.property.mockResolvedValue({ ...property, ...fields });
    const body = await (await request()).json();
    expect(body.access).toEqual({ recorded: true });
    expect(Object.keys(body).sort()).toEqual(["access", "pricing", "propertyId", "serviceType", "timing"]);
    expect(JSON.stringify(body)).not.toMatch(/secret|accessCode|accessNotes|keyLocation|accessGuide|accessInfo|provider|lineItems/);
  });

  it.each([
    {}, { accessCode: "  ", keyLocation: "\n", accessNotes: "" },
    { accessGuide: [{}] }, { accessGuide: [{ id: "entry", kind: "ENTRY", label: "Entry", images: [{}], instructions: " " }] },
    { accessInfo: { defaultCleanDurationHours: 3, maxGuestCount: 4, laundryTeamUserIds: ["user"] } },
    { accessInfo: { codes: false, instructions: " ", attachments: [{}] } }, { accessInfo: "invalid", accessGuide: "invalid" },
  ])("ignores empty or metadata-only access %j", async fields => {
    mocks.property.mockResolvedValue({ ...property, ...fields });
    expect((await (await request()).json()).access).toEqual({ recorded: false });
  });

  it.each(["PROPERTY", "ICAL", "property", "ICAL_SECRET", "", null])("allows only exact time source %s", async source => {
    mocks.property.mockResolvedValue({ ...property, jobTimeSource: source });
    expect((await (await request()).json()).timing).toEqual({
      checkin: "14:00", checkout: "10:00", source: source === "PROPERTY" || source === "ICAL" ? source : null,
    });
  });

  it.each(["24:00", "12:60", "9:00", "14:00:00", " 14:00", "secret", "", null])("nulls invalid HH:mm %s", async value => {
    mocks.property.mockResolvedValue({ ...property, defaultCheckinTime: value, defaultCheckoutTime: value });
    expect((await (await request()).json()).timing).toEqual({ checkin: null, checkout: null, source: "PROPERTY" });
  });

  it("accepts boundary times independently", async () => {
    mocks.property.mockResolvedValue({ ...property, defaultCheckinTime: "00:00", defaultCheckoutTime: "23:59" });
    expect((await (await request()).json()).timing).toEqual({ checkin: "00:00", checkout: "23:59", source: "PROPERTY" });
  });
});
