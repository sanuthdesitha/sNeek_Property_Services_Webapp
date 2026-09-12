import { describe, expect, it } from "vitest";
import { maintenanceScheduleLabel, maintenanceVisitStage, type MaintenanceTicketSummary } from "@/lib/maintenance/ticket-stage";

const ticket: MaintenanceTicketSummary = { id: "1", title: "Leak", priority: "HIGH", status: "OPEN", scheduledFor: null, enRouteAt: null, arrivedAt: null, clockInAt: null, clockOutAt: null, outcome: null, costApprovalStatus: null, property: null };
describe("maintenance visit status", () => {
  it.each([
    [{ status: "RESOLVED", outcome: "NEEDS_PARTS" }, "Resolved"],
    [{ status: "DISMISSED" }, "Dismissed"],
    [{ outcome: "NEEDS_PARTS", clockOutAt: "2026-09-10T01:00:00Z" }, "Needs parts"],
    [{ outcome: "NEEDS_FOLLOWUP" }, "Needs follow-up"],
    [{ outcome: "NO_ACCESS" }, "No access"],
    [{ outcome: "OTHER" }, "Visit ended; work order remains open"],
    [{ clockOutAt: "2026-09-10T01:00:00Z" }, "Visit ended; work order remains open"],
    [{ clockInAt: "2026-09-10T01:00:00Z" }, "On site"],
    [{ arrivedAt: "2026-09-10T01:00:00Z" }, "Arrived"],
    [{ enRouteAt: "2026-09-10T01:00:00Z" }, "En route"],
    [{ scheduledFor: "2026-09-10T01:00:00Z" }, "Visit planned"],
    [{}, "Not scheduled"],
  ])("derives %j as %s without treating an unresolved visit as closed", (overrides, expected) => {
    expect(maintenanceVisitStage({ ...ticket, ...overrides })).toBe(expected);
  });
  it("renders schedules in Sydney and distinguishes unknown or invalid scheduling", () => {
    expect(maintenanceScheduleLabel(null)).toBe("Not scheduled");
    expect(maintenanceScheduleLabel("invalid")).toBe("Schedule unavailable");
    expect(maintenanceScheduleLabel("2026-09-09T23:00:00Z")).toMatch(/Thu.*10 Sept.*9:00 am/);
  });
});
