import { describe, it, expect } from "vitest";
import { DamageSeverity, DamageReportStatus } from "@prisma/client";
import { toInvestigationViewModel } from "@/lib/damage/investigation";

/**
 * One assembler serves both audiences, so the redaction is the thing worth
 * testing: a client must never receive a repair cost (they would read a working
 * figure as a quote) or an internal triage note. Testing it here, on the mapper,
 * means the guarantee does not depend on every template remembering to hide a
 * field.
 */

const row = {
  id: "clx0rep1",
  status: DamageReportStatus.SUBMITTED,
  submittedAt: new Date("2026-08-16T04:12:00.000Z"),
  clientVisible: true,
  reviewedAt: new Date("2026-08-16T06:00:00.000Z"),
  reviewedBy: { name: "Admin Person", email: "admin@example.com" },
  reportedBy: { name: "Cleaner Person", email: "cleaner@example.com" },
  jobId: "clx0job1",
  propertyId: "clx0prop1",
  property: { id: "clx0prop1", name: "Seaview 12" },
  items: [
    {
      id: "clx0item1",
      area: "Kitchen",
      category: "Benchtop",
      severity: DamageSeverity.MAJOR,
      description: "Deep burn mark near the cooktop.",
      suspectedCause: "GUEST",
      estimatedCost: 420.5,
      photos: [
        {
          id: "p1",
          s3Key: "damage/original.jpg",
          annotatedKey: "damage/overlay.png",
          flatKey: "damage/flat.jpg",
          caption: "Burn",
          section: "CLOSE_UP",
        },
        {
          id: "p2",
          s3Key: "damage/plain.jpg",
          annotatedKey: null,
          flatKey: null,
          caption: null,
          section: "OVERVIEW",
        },
      ],
      case: {
        id: "clx0case1",
        state: "INVESTIGATING",
        status: "OPEN",
        transitions: [
          {
            id: "t1",
            fromState: "OPEN",
            toState: "INVESTIGATING",
            reason: "Internal: chasing the guest's card on file",
            occurredAt: new Date("2026-08-16T05:00:00.000Z"),
            actor: { name: "Admin Person", email: "admin@example.com" },
          },
        ],
        maintenanceItems: [
          {
            id: "clx0maint1",
            title: "Damage: Benchtop",
            status: "IN_PROGRESS",
            priority: "HIGH",
            scheduledFor: new Date("2026-08-18T00:00:00.000Z"),
            resolvedAt: null,
            assignedWorker: { name: "Stonemason Pty" },
          },
        ],
      },
    },
    {
      id: "clx0item2",
      area: "Bathroom",
      category: "Mirror",
      severity: DamageSeverity.MINOR,
      description: "Small chip in the corner.",
      suspectedCause: "WEAR",
      estimatedCost: 60,
      photos: [],
      case: null,
    },
  ],
};

describe("toInvestigationViewModel — ADMIN", () => {
  it("keeps the repair costs", () => {
    const vm = toInvestigationViewModel(row, "ADMIN");
    expect(vm.items[0].estimatedCost).toBe(420.5);
    expect(vm.items[1].estimatedCost).toBe(60);
  });

  it("keeps internal transition reasons and the reviewer", () => {
    const vm = toInvestigationViewModel(row, "ADMIN");
    expect(vm.items[0].transitions[0].reason).toMatch(/chasing the guest/i);
    expect(vm.reviewedByName).toBe("Admin Person");
  });
});

describe("toInvestigationViewModel — CLIENT", () => {
  it("never exposes a repair cost", () => {
    const vm = toInvestigationViewModel(row, "CLIENT");
    for (const item of vm.items) {
      expect(item.estimatedCost).toBeNull();
    }
    // Belt and braces: the serialised payload must not carry the figure at all.
    expect(JSON.stringify(vm)).not.toContain("420.5");
  });

  it("strips internal transition reasons but keeps the timeline itself", () => {
    const vm = toInvestigationViewModel(row, "CLIENT");
    expect(vm.items[0].transitions).toHaveLength(1);
    expect(vm.items[0].transitions[0].reason).toBeNull();
    expect(vm.items[0].transitions[0].toState).toBe("INVESTIGATING");
    expect(JSON.stringify(vm)).not.toContain("chasing the guest");
  });

  it("does not name the internal reviewer", () => {
    expect(toInvestigationViewModel(row, "CLIENT").reviewedByName).toBeNull();
  });

  it("still shows repair progress — the client is told what is happening", () => {
    const vm = toInvestigationViewModel(row, "CLIENT");
    expect(vm.items[0].maintenance[0].status).toBe("IN_PROGRESS");
    expect(vm.items[0].caseState).toBe("INVESTIGATING");
  });
});

describe("photo selection", () => {
  it("shows the flattened composite when one exists, never the bare overlay", () => {
    const vm = toInvestigationViewModel(row, "ADMIN");
    const [annotated, plain] = vm.items[0].photos;
    // The overlay alone is marks on transparency and renders as a black tile.
    expect(annotated.url).toContain("flat.jpg");
    expect(annotated.url).not.toContain("overlay.png");
    expect(annotated.annotated).toBe(true);
    expect(plain.url).toContain("plain.jpg");
    expect(plain.annotated).toBe(false);
  });
});

describe("report-level derivation", () => {
  it("reports the worst severity across its items", () => {
    expect(toInvestigationViewModel(row, "ADMIN").highestSeverity).toBe(DamageSeverity.MAJOR);
  });

  it("tolerates an item with no case yet", () => {
    const vm = toInvestigationViewModel(row, "ADMIN");
    expect(vm.items[1].caseId).toBeNull();
    expect(vm.items[1].transitions).toEqual([]);
    expect(vm.items[1].maintenance).toEqual([]);
  });

  it("handles a report with no items at all", () => {
    const vm = toInvestigationViewModel({ ...row, items: [] }, "ADMIN");
    expect(vm.items).toEqual([]);
    expect(vm.highestSeverity).toBeNull();
  });
});
