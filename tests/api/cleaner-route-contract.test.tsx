// @vitest-environment node
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), assignments: vi.fn(), user: vi.fn(), driving: vi.fn(), redirect: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.session }));
vi.mock("@/lib/db", () => ({ db: {
  jobAssignment: { findMany: mocks.assignments }, user: { findUnique: mocks.user },
} }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/v2/ui/primitives", () => ({ EPageHeader: () => null }));
vi.mock("@/components/v2/cleaner/route-driving", () => ({ RouteDriving: mocks.driving }));

import { GET } from "@/app/api/cleaner/today-route/route";
import Page from "@/app/v2/cleaner/route/page";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";

async function request(query = "") {
  const response = await GET(new Request(`http://localhost/api/cleaner/today-route${query}`));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  return response;
}

async function load(surface: string) {
  if (surface === "api") {
    const response = await request();
    expect(response.status).toBe(200);
    return response.json();
  }
  renderToStaticMarkup(await Page());
  const props = mocks.driving.mock.lastCall![0];
  return { stops: props.initialStops, date: props.initialDate };
}

function job(overrides = {}) {
  return {
    id: "job-1", jobNumber: 42, jobType: "GENERAL_CLEAN", status: "ASSIGNED",
    startTime: "09:00", dueTime: "14:00", estimatedHours: 2.5,
    sameDayCheckin: true, sameDayCheckinTime: "14:00",
    internalNotes: serializeJobInternalNotes({
      internalNoteText: "PRIVATE NOTE DO NOT EXPOSE",
      earlyCheckin: { enabled: true, preset: "11:00" },
      lateCheckout: { enabled: true, preset: "custom", time: "12:45" },
    }),
    enRouteStartedAt: null, enRouteEtaMinutes: null, arrivedAt: null,
    drivingPausedAt: new Date("2026-09-08T23:30:00Z"), drivingPauseReason: "Traffic",
    property: {
      name: "Home", address: "1 Test St", suburb: "Sydney", state: "NSW",
      postcode: "2000", latitude: -33.86, longitude: 151.2,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T15:00:00Z"));
  mocks.session.mockResolvedValue({ user: { id: "cleaner-1", role: Role.CLEANER } });
  mocks.assignments.mockResolvedValue([]);
  mocks.user.mockResolvedValue({ preferredTransport: "DRIVING" });
  mocks.driving.mockReturnValue(null);
  mocks.redirect.mockImplementation((url: string) => { throw new Error(`REDIRECT:${url}`); });
});
afterEach(() => vi.useRealTimers());

describe.each(["api", "page"])("%s route contract", (surface) => {
  it.each([
    ["2026-09-08T15:00:00Z", "2026-09-09", "2026-09-08T14:00:00.000Z", "2026-09-09T14:00:00.000Z"],
    ["2026-04-04T14:00:00Z", "2026-04-05", "2026-04-04T13:00:00.000Z", "2026-04-05T14:00:00.000Z"],
    ["2026-10-03T15:00:00Z", "2026-10-04", "2026-10-03T14:00:00.000Z", "2026-10-04T13:00:00.000Z"],
  ])("scopes the Sydney day at %s, including DST", async (now, date, start, end) => {
    vi.setSystemTime(new Date(now));
    expect(await load(surface)).toEqual({ stops: [], date });
    expect(mocks.assignments.mock.lastCall![0].where).toEqual({
      userId: "cleaner-1", removedAt: null,
      job: {
        scheduledDate: { gte: new Date(start), lt: new Date(end) },
        status: { notIn: ["COMPLETED", "INVOICED"] },
        cleanSkipStatus: { not: "SKIPPED" },
      },
    });
    expect(mocks.assignments.mock.lastCall![0].orderBy).toEqual([{ job: { startTime: "asc" } }]);
  });

  it.each([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER])("keeps the existing role gate and session owner for %s", async (role) => {
    mocks.session.mockResolvedValue({ user: { id: "active-owner", role } });
    await load(surface);
    expect(mocks.session).toHaveBeenCalledWith([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    expect(mocks.assignments.mock.lastCall![0].where.userId).toBe("active-owner");
  });

  it("exposes derived timing and check-in metadata without raw notes", async () => {
    mocks.assignments.mockResolvedValue([{ job: job() }]);
    const payload = await load(surface);
    expect(payload.stops[0]).toMatchObject({
      jobId: "job-1", estimatedHours: 2.5,
      timingBadges: { early: "11:00", late: "12:45" },
      sameDayCheckin: true, sameDayCheckinTime: "14:00",
      drivingPausedAt: "2026-09-08T23:30:00.000Z", drivingPauseReason: "Traffic",
    });
    expect(payload.stops[0]).not.toHaveProperty("internalNotes");
    expect(JSON.stringify(payload)).not.toContain("PRIVATE NOTE");
    expect(mocks.assignments.mock.lastCall![0].include.job.select).toMatchObject({
      internalNotes: true, estimatedHours: true, sameDayCheckin: true, sameDayCheckinTime: true,
    });
  });

  it("retains null metadata and false check-in flags", async () => {
    mocks.assignments.mockResolvedValue([{ job: job({
      internalNotes: null, estimatedHours: null, sameDayCheckin: false, sameDayCheckinTime: null,
    }) }]);
    expect((await load(surface)).stops[0]).toMatchObject({
      timingBadges: null, estimatedHours: null, sameDayCheckin: false, sameDayCheckinTime: null,
    });
  });
});

describe("API date selection and failures", () => {
  it.each([
    ["2026-04-03T15:00:00Z", "?relative=tomorrow", "2026-04-05", "2026-04-04T13:00:00.000Z", "2026-04-05T14:00:00.000Z"],
    ["2026-10-02T15:00:00Z", "?relative=tomorrow", "2026-10-04", "2026-10-03T14:00:00.000Z", "2026-10-04T13:00:00.000Z"],
    ["2026-12-30T15:00:00Z", "?relative=tomorrow", "2027-01-01", "2026-12-31T13:00:00.000Z", "2027-01-01T13:00:00.000Z"],
    ["2026-09-08T15:00:00Z", "?date=2026-04-05", "2026-04-05", "2026-04-04T13:00:00.000Z", "2026-04-05T14:00:00.000Z"],
    ["2026-09-08T15:00:00Z", "?date=2026-10-04", "2026-10-04", "2026-10-03T14:00:00.000Z", "2026-10-04T13:00:00.000Z"],
    ["2026-09-08T15:00:00Z", "?date=2028-02-29", "2028-02-29", "2028-02-28T13:00:00.000Z", "2028-02-29T13:00:00.000Z"],
  ])("resolves %s %s", async (now, query, date, start, end) => {
    vi.setSystemTime(new Date(now));
    const response = await request(query);
    expect(response.status).toBe(200);
    expect((await response.json()).date).toBe(date);
    expect(mocks.assignments.mock.lastCall![0].where.job.scheduledDate).toEqual({
      gte: new Date(start), lt: new Date(end),
    });
  });

  it.each(["", "bad", "2026-2-01", "2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "0000-01-01", "2026-09-09T00:00:00Z"])("rejects invalid calendar date %s", async (date) => {
    const response = await request(`?date=${encodeURIComponent(date)}`);
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("stops");
    expect(mocks.assignments).not.toHaveBeenCalled();
  });

  it("rejects invalid explicit dates even with tomorrow selected", async () => {
    expect((await request("?relative=tomorrow&date=2026-02-30")).status).toBe(400);
    expect(mocks.assignments).not.toHaveBeenCalled();
  });

  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403], ["private database details", 503]])("maps auth error %s to %s", async (error, status) => {
    mocks.session.mockRejectedValue(new Error(String(error)));
    const response = await request();
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private database details");
    expect(mocks.assignments).not.toHaveBeenCalled();
  });

  it("reports assignment-read failure as 503, never an empty route", async () => {
    mocks.assignments.mockRejectedValue(new Error("private database details"));
    const response = await request();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).not.toHaveProperty("stops");
    expect(body.error).toContain("retry");
    expect(JSON.stringify(body)).not.toContain("private database details");
  });
});

describe("page failure state", () => {
  it.each(["assignments", "user"] as const)("shows Retry after %s read fails, without mounting an empty route", async (source) => {
    mocks[source].mockRejectedValue(new Error("private database details"));
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/v2/cleaner/route"');
    expect(html).toContain("Retry");
    expect(html).not.toContain("private database details");
    expect(mocks.driving).not.toHaveBeenCalled();
  });
});
