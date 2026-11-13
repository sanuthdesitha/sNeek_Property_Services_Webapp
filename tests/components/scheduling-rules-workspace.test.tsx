/**
 * Settings › Scheduling rules screen: separate loading / unavailable / stale /
 * ready states, read-only by default, the unlock prompt only for editors, and
 * a draft that survives switching tabs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RulesWorkspace } from "@/components/v2/admin/settings/scheduling-rules/rules-workspace";
import { EDITABLE_RULE_KEYS, EDITABLE_RULE_SPECS, ORIGINAL_CODE_VALUES, SETTINGS_FIELD_DEFAULTS } from "@/lib/scheduling-rules/values";
import type { SchedulingRulesView } from "@/lib/scheduling-rules/view-types";

const values = { ...ORIGINAL_CODE_VALUES, ...SETTINGS_FIELD_DEFAULTS } as SchedulingRulesView["versions"][number]["values"];

function view(patch: Partial<SchedulingRulesView> = {}): SchedulingRulesView {
  return {
    liveVersion: 1,
    latestVersion: 1,
    liveEffectiveLabel: "From the start",
    rules: [
      { id: "laundry.pickup", domain: "laundry", section: "Pickup and drop-off dates", title: "Pickup day", kind: "editable", editableKey: "laundry.pickupOffsetDays", valueText: "1 day", sentence: "Linen is picked up 1 day after the clean.", appliesTo: "Laundry planner (new runs)", takesEffect: "new-work", origin: "Was fixed in code (1 day)", quirk: null, scheduledValueText: null },
      { id: "laundry.weekends", domain: "laundry", section: "Times, weekends and holidays", title: "Weekends and public holidays", kind: "not-applied", editableKey: null, valueText: "Not applied", sentence: "The planner does not skip or move runs for weekends or public holidays.", appliesTo: "—", takesEffect: "display", origin: "No such rule exists", quirk: null, scheduledValueText: null },
      { id: "jobs.ready-by", domain: "jobs", section: "Turnovers from booking calendars", title: "Ready by", kind: "editable", editableKey: "jobs.turnoverReadyByTime", valueText: "15:00", sentence: "A turnover must be finished by 15:00 at the latest.", appliesTo: "iCal turnovers (new jobs)", takesEffect: "new-work", origin: "Was fixed in code (15:00)", quirk: null, scheduledValueText: null },
    ],
    versions: [{ version: 1, kind: "ORIGINAL", label: "Original (current behaviour)", effectiveFrom: "2000-01-01", effectiveLabel: "From the start", appliesToExisting: false, reason: "Original", restoredFromVersion: null, createdAt: "14 Nov 2026, 09:00", createdBy: "System", status: "LIVE", changeCount: 0, values }],
    specs: Object.fromEntries(EDITABLE_RULE_KEYS.map((key) => [key, { type: (EDITABLE_RULE_SPECS[key] as any).type, min: (EDITABLE_RULE_SPECS[key] as any).min, max: (EDITABLE_RULE_SPECS[key] as any).max, unit: (EDITABLE_RULE_SPECS[key] as any).unit }])) as SchedulingRulesView["specs"],
    drift: [],
    workerSchedule: [{ name: "ical-sync", when: "Hourly", does: "Reads booking calendars." }],
    canEdit: false,
    earliestEffectiveFrom: "2026-11-15",
    coolDownUntil: null,
    timezone: "Australia/Sydney",
    readAt: "2026-11-14T00:00:00.000Z",
    ...patch,
  };
}

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Scheduling rules screen", () => {
  it("shows loading, then the rules read-only for a viewer", async () => {
    fetchMock.mockImplementation(() => respond(200, view()));
    render(<RulesWorkspace />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
    expect(await screen.findByText("Pickup day")).toBeInTheDocument();
    expect(screen.getByText(/Version 1 is live/)).toBeInTheDocument();
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Unlock/ })).toBeNull();
    expect(screen.getByText("Not applied", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("an unavailable store is shown as unavailable with Retry, never as an empty list", async () => {
    fetchMock.mockImplementationOnce(() => respond(503, { error: "Scheduling rules are unavailable: version 1 failed its checksum.", code: "SCHEDULING_RULES_UNAVAILABLE" }));
    render(<RulesWorkspace />);
    expect(await screen.findByText("Scheduling rules unavailable")).toBeInTheDocument();
    expect(screen.getByText(/nothing is planned on guessed values/)).toBeInTheDocument();
    fetchMock.mockImplementationOnce(() => respond(200, view()));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Pickup day")).toBeInTheDocument();
  });

  it("an editor sees the lock and the Jobs tab with the worker schedule", async () => {
    fetchMock.mockImplementation(() => respond(200, view({ canEdit: true })));
    render(<RulesWorkspace />);
    expect(await screen.findByRole("button", { name: /Unlock to change/ })).toBeInTheDocument();
    expect(screen.getByText(/cannot be changed by accident/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Jobs" }));
    expect(screen.getByText("Ready by")).toBeInTheDocument();
    expect(screen.getByText(/Reads booking calendars/)).toBeInTheDocument();
  });

  it("keeps a draft while switching tabs after unlocking", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target.endsWith("/unlock") && init?.method === "POST") return respond(200, { token: "tok", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
      if (target === "/api/me/admin-pin") return respond(200, { hasPin: true });
      return respond(200, view({ canEdit: true }));
    });
    render(<RulesWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Unlock to change/ }));
    fireEvent.change(await screen.findByLabelText(/Your PIN/), { target: { value: "2468" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    const input = await screen.findByRole("spinbutton", { name: /Pickup day/ });
    fireEvent.change(input, { target: { value: "2" } });
    expect(await screen.findByText(/Draft: 1 change/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("tab", { name: "Laundry" }));
    expect(screen.getByText(/Draft: 1 change/)).toBeInTheDocument();
    expect((screen.getByRole("spinbutton", { name: /Pickup day/ }) as HTMLInputElement).value).toBe("2");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/settings/scheduling-rules/unlock", expect.objectContaining({ method: "POST" })));
  });
});
