// @vitest-environment node
/** Pilot "New cleaner job flow": off, on, scoped, unreadable, and a job started before it was switched on keeps the old flow. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allOff, parsePilotState, type PilotState } from "@/lib/pilots/registry";

const m = vi.hoisted(() => ({ state: null as unknown as PilotState }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/pilots/state", () => ({ loadPilotState: async () => m.state, isPilotOn: vi.fn() }));

import { cleanerJobFlowOn } from "@/lib/pilots/gates";

const ON_SINCE = "2026-11-28T03:00:00.000Z";
const subject = { jobId: "job-1", userId: "cleaner-a", propertyId: "property-1" };

function withFirstClockIn(startedAt: Date | null) {
  const findFirst = vi.fn(async () => (startedAt ? { startedAt } : null));
  return { db: { timeLog: { findFirst } }, findFirst };
}

function setting(mode: "OFF" | "ON" | "SCOPED", extra: Record<string, unknown> = {}) {
  return parsePilotState({ "cleaner-job-flow": { mode, userIds: [], propertyIds: [], onSince: mode === "OFF" ? null : ON_SINCE, changedAt: ON_SINCE, changedById: "admin", ...extra } });
}

beforeEach(() => {
  m.state = allOff(true);
});

describe("cleanerJobFlowOn", () => {
  it("off: the previous flow, without reading the time log", async () => {
    const { db, findFirst } = withFirstClockIn(null);
    expect(await cleanerJobFlowOn(db, subject)).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("unreadable state counts as off", async () => {
    m.state = parsePilotState("garbage");
    expect(await cleanerJobFlowOn(withFirstClockIn(null).db, subject)).toBe(false);
  });

  it("on: a job not started yet, or first started after it was switched on, gets the new flow", async () => {
    m.state = setting("ON");
    expect(await cleanerJobFlowOn(withFirstClockIn(null).db, subject)).toBe(true);
    expect(await cleanerJobFlowOn(withFirstClockIn(new Date("2026-11-28T04:00:00Z")).db, subject)).toBe(true);
  });

  it("switched on mid-job: a job first started before keeps the previous flow to the end", async () => {
    m.state = setting("ON");
    const { db, findFirst } = withFirstClockIn(new Date("2026-11-28T02:59:00Z"));
    expect(await cleanerJobFlowOn(db, subject)).toBe(false);
    expect(findFirst).toHaveBeenCalledWith({ where: { jobId: "job-1" }, orderBy: { startedAt: "asc" }, select: { startedAt: true } });
  });

  it("scoped: only the chosen cleaner or property", async () => {
    m.state = setting("SCOPED", { userIds: ["cleaner-b"], propertyIds: ["property-9"] });
    expect(await cleanerJobFlowOn(withFirstClockIn(null).db, subject)).toBe(false);
    expect(await cleanerJobFlowOn(withFirstClockIn(null).db, { ...subject, userId: "cleaner-b" })).toBe(true);
    expect(await cleanerJobFlowOn(withFirstClockIn(null).db, { ...subject, propertyId: "property-9" })).toBe(true);
  });
});
