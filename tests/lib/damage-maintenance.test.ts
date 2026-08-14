import { describe, it, expect } from "vitest";
import { MaintenanceCategory, MaintenancePriority, MaintenanceStatus } from "@prisma/client";
import {
  buildMaintenanceDraftFromCase,
  caseStatusForMaintenanceStatus,
  isMeaningfulChange,
  maintenancePriorityForSeverity,
  maintenanceStatusForCaseStatus,
  shouldAutoCreateMaintenance,
} from "@/lib/cases/damage-maintenance";

const DAMAGE_CASE = {
  id: "clx0000case001",
  caseType: "DAMAGE",
  propertyId: "clx0000prop1",
  title: "Cracked shower screen",
  description: "Glass panel cracked in the ensuite.",
  severity: "HIGH",
  status: "OPEN",
};

describe("shouldAutoCreateMaintenance", () => {
  it("raises a repair for a DAMAGE case attached to a property", () => {
    expect(shouldAutoCreateMaintenance(DAMAGE_CASE)).toBe(true);
  });

  it("is case-insensitive about the case type", () => {
    expect(shouldAutoCreateMaintenance({ ...DAMAGE_CASE, caseType: "damage" })).toBe(true);
  });

  it("refuses non-damage case types", () => {
    // Disputes and lost-and-found are paperwork; auto-raising repairs for them
    // would bury the real ones.
    for (const caseType of ["CLIENT_DISPUTE", "LOST_FOUND", "OPS", "SLA", "OTHER"]) {
      expect(shouldAutoCreateMaintenance({ ...DAMAGE_CASE, caseType })).toBe(false);
    }
  });

  it("refuses a damage case with no property — there is nowhere to send anyone", () => {
    expect(shouldAutoCreateMaintenance({ ...DAMAGE_CASE, propertyId: null })).toBe(false);
    expect(shouldAutoCreateMaintenance({ ...DAMAGE_CASE, propertyId: "   " })).toBe(false);
  });
});

describe("maintenancePriorityForSeverity", () => {
  it("maps each severity onto a repair priority", () => {
    expect(maintenancePriorityForSeverity("CRITICAL")).toBe(MaintenancePriority.URGENT);
    expect(maintenancePriorityForSeverity("HIGH")).toBe(MaintenancePriority.HIGH);
    expect(maintenancePriorityForSeverity("MEDIUM")).toBe(MaintenancePriority.MEDIUM);
    expect(maintenancePriorityForSeverity("LOW")).toBe(MaintenancePriority.LOW);
  });

  it("falls back to MEDIUM for anything unrecognised", () => {
    expect(maintenancePriorityForSeverity(null)).toBe(MaintenancePriority.MEDIUM);
    expect(maintenancePriorityForSeverity("nonsense")).toBe(MaintenancePriority.MEDIUM);
  });
});

describe("maintenanceStatusForCaseStatus", () => {
  it("carries the terminal states across", () => {
    expect(maintenanceStatusForCaseStatus("RESOLVED")).toBe(MaintenanceStatus.RESOLVED);
    expect(maintenanceStatusForCaseStatus("CLOSED")).toBe(MaintenanceStatus.RESOLVED);
  });

  it("carries active investigation across", () => {
    expect(maintenanceStatusForCaseStatus("INVESTIGATING")).toBe(MaintenanceStatus.IN_PROGRESS);
    expect(maintenanceStatusForCaseStatus("OPEN")).toBe(MaintenanceStatus.OPEN);
    expect(maintenanceStatusForCaseStatus("TRIAGE")).toBe(MaintenanceStatus.OPEN);
  });

  it("says nothing for waiting states rather than dragging the repair backwards", () => {
    // Waiting on the client tells us nothing about whether the plumber has been.
    expect(maintenanceStatusForCaseStatus("WAITING_CLIENT")).toBeNull();
    expect(maintenanceStatusForCaseStatus("WAITING_INTERNAL")).toBeNull();
    expect(maintenanceStatusForCaseStatus(null)).toBeNull();
  });
});

describe("caseStatusForMaintenanceStatus", () => {
  it("resolves the case when the repair is done", () => {
    expect(caseStatusForMaintenanceStatus(MaintenanceStatus.RESOLVED)).toBe("RESOLVED");
  });

  it("closes the case when the repair is dismissed", () => {
    expect(caseStatusForMaintenanceStatus(MaintenanceStatus.DISMISSED)).toBe("CLOSED");
  });

  it("reports work in progress", () => {
    expect(caseStatusForMaintenanceStatus(MaintenanceStatus.IN_PROGRESS)).toBe("INVESTIGATING");
  });

  it("stays quiet for intermediate repair states", () => {
    // Acknowledging or ordering a part should not reword the client's case.
    expect(caseStatusForMaintenanceStatus(MaintenanceStatus.ACKNOWLEDGED)).toBeNull();
    expect(caseStatusForMaintenanceStatus(MaintenanceStatus.ORDERED)).toBeNull();
    expect(caseStatusForMaintenanceStatus(MaintenanceStatus.OPEN)).toBeNull();
  });
});

describe("isMeaningfulChange", () => {
  // This is the loop guard: without it, syncing A->B would trigger B->A forever.
  it("is false when the value is unchanged", () => {
    expect(isMeaningfulChange("RESOLVED", "RESOLVED")).toBe(false);
    expect(isMeaningfulChange("resolved", "RESOLVED")).toBe(false);
  });

  it("is true for a real change", () => {
    expect(isMeaningfulChange("OPEN", "RESOLVED")).toBe(true);
  });

  it("is false when there is no next value to apply", () => {
    expect(isMeaningfulChange("OPEN", null)).toBe(false);
    expect(isMeaningfulChange(null, undefined)).toBe(false);
  });
});

describe("buildMaintenanceDraftFromCase", () => {
  it("marks the repair as damage-sourced and carries severity into priority", () => {
    const draft = buildMaintenanceDraftFromCase(DAMAGE_CASE);
    expect(draft.title).toBe("Damage: Cracked shower screen");
    expect(draft.description).toBe("Glass panel cracked in the ensuite.");
    expect(draft.priority).toBe(MaintenancePriority.HIGH);
    expect(draft.category).toBe(MaintenanceCategory.OTHER);
  });

  it("falls back to a usable title when the case has none", () => {
    expect(buildMaintenanceDraftFromCase({ id: "c", title: "   " }).title).toBe("Damage: Reported damage");
  });

  it("keeps the title inside the column limit", () => {
    const draft = buildMaintenanceDraftFromCase({ id: "c", title: "x".repeat(400) });
    expect(draft.title.length).toBeLessThanOrEqual(180);
  });

  it("nulls an empty description rather than storing whitespace", () => {
    expect(buildMaintenanceDraftFromCase({ id: "c", description: "  " }).description).toBeNull();
  });
});
