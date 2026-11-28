// @vitest-environment node
/** Start briefing source under the pilots: Property reminders (facts) and Before-you-start extras (open QA issues). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePilotState, type PilotState } from "@/lib/pilots/registry";

const m = vi.hoisted(() => ({ state: null as unknown as PilotState, issues: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { qaIssue: { findMany: m.issues } } }));
vi.mock("@/lib/pilots/state", async () => {
  const registry = await vi.importActual<typeof import("@/lib/pilots/registry")>("@/lib/pilots/registry");
  return {
    loadPilotState: async () => m.state,
    isPilotOn: async (key: Parameters<typeof registry.pilotApplies>[1], subject: Parameters<typeof registry.pilotApplies>[2]) => registry.pilotApplies(m.state, key, subject),
  };
});

import { reminderSource, reminderSourceByUser } from "@/lib/pilots/gates";
import { resolvePropertyReminders } from "@/lib/properties/property-reminders";
import { resolveStartBriefingItems, startBriefingHash } from "@/lib/forms/start-briefing";

const on = (extra: Record<string, unknown> = {}) => ({ mode: "ON", userIds: [], propertyIds: [], onSince: null, changedAt: null, changedById: null, ...extra });
const property = { features: { livePlants: true } };
const subject = { userId: "cleaner-a", propertyId: "property-1" };

beforeEach(() => {
  m.state = parsePilotState(null);
  m.issues.mockReset().mockResolvedValue([{ id: "qa-1", category: "BATHROOM_HAIR", description: "Hair left in the shower drain" }]);
});

describe("start briefing source", () => {
  it("both off: null, the list from before, and QA issues are not read", async () => {
    expect(await reminderSource(property, subject)).toBeNull();
    expect(m.issues).not.toHaveBeenCalled();
  });

  it("extras on: open QA issues at the property only (no plants without Property reminders)", async () => {
    m.state = parsePilotState({ "before-start-extras": on() });
    const source = await reminderSource(property, subject);
    const reminders = resolvePropertyReminders(source);
    expect(reminders).toEqual([{ id: "property-reminder-qa-qa-1", title: "Open QA issue here: Bathroom hair", detail: "Check it is fixed this time: Hair left in the shower drain" }]);
    expect(m.issues).toHaveBeenCalledWith(expect.objectContaining({ where: { propertyId: "property-1", rectificationStatus: { in: ["PENDING", "RETURNED_TO_CLEANER", "NOT_FIXED", "ESCALATED"] } }, take: 5 }));
  });

  it("both on: plants then the QA issue; the briefing fingerprint changes when an issue is added", async () => {
    m.state = parsePilotState({ "before-start-extras": on(), "property-reminders": on() });
    const source = await reminderSource(property, subject);
    expect(resolvePropertyReminders(source).map((item) => item.id)).toEqual(["property-reminder-live-plants", "property-reminder-qa-qa-1"]);
    const withIssue = resolveStartBriefingItems({ meta: {}, property: source });
    const without = resolveStartBriefingItems({ meta: {}, property: { features: property.features } });
    expect(startBriefingHash(withIssue)).not.toBe(startBriefingHash(without));
    expect(withIssue.find((item) => item.id === "property-reminder-qa-qa-1")?.source).toBe("PROPERTY_REMINDER");
  });

  it("a failed QA read gives no QA items, never blocks", async () => {
    m.state = parsePilotState({ "before-start-extras": on() });
    m.issues.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(resolvePropertyReminders(await reminderSource(property, subject))).toEqual([]);
  });

  it("the office proof decides per cleaner (scoped extras)", async () => {
    m.state = parsePilotState({ "before-start-extras": on({ mode: "SCOPED", userIds: ["cleaner-a"] }) });
    const sourceFor = await reminderSourceByUser(property, "property-1");
    expect(resolvePropertyReminders(sourceFor("cleaner-a"))).toHaveLength(1);
    expect(sourceFor("cleaner-b")).toBeNull();
  });
});
