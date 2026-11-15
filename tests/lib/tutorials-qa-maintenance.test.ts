// @vitest-environment node
/**
 * QA and Maintenance page tours (2026-11-17): each tour is a page tour for its
 * one role, on a real route, with steps that point at controls of that page
 * which exist in the source, at most 25 words each, and listed in Help.
 */
import { describe, expect, it } from "vitest";
import { findTour, toursForRole } from "@/lib/tutorials/registry";
import { TOUR_TARGETS } from "@/lib/tutorials/targets";
import { countWords, matchesRoute } from "@/lib/tutorials/engine";
import { scanTourTargets } from "@/lib/tutorials/source-scan";
import { RELEASE_NOTES } from "@/lib/tutorials/releases";

const NEW_TOURS = [
  { key: "qa.today", role: "QA_INSPECTOR", portal: "qa", route: "/v2/qa", sample: "/v2/qa", steps: 5 },
  { key: "qa.inspection", role: "QA_INSPECTOR", portal: "qa", route: "/v2/qa/jobs/[id]", sample: "/v2/qa/jobs/job-1", steps: 7 },
  { key: "qa.reviews", role: "QA_INSPECTOR", portal: "qa", route: "/v2/qa/reviews", sample: "/v2/qa/reviews", steps: 3 },
  { key: "maintenance.today", role: "MAINTENANCE", portal: "maintenance", route: "/v2/maintenance", sample: "/v2/maintenance", steps: 4 },
  { key: "maintenance.tickets", role: "MAINTENANCE", portal: "maintenance", route: "/v2/maintenance/tickets", sample: "/v2/maintenance/tickets", steps: 4 },
  { key: "maintenance.visit", role: "MAINTENANCE", portal: "maintenance", route: "/v2/maintenance/visits/[id]", sample: "/v2/maintenance/visits/item-1", steps: 8 },
] as const;

const scan = scanTourTargets(process.cwd());

describe.each(NEW_TOURS)("$key", (expected) => {
  const tour = findTour(expected.key)!;

  it("is a page tour for its role on its route", () => {
    expect(tour).toBeTruthy();
    expect(tour.kind).toBe("page");
    expect(tour.portal).toBe(expected.portal);
    expect(tour.roles).toEqual([expected.role]);
    expect(tour.route).toBe(expected.route);
    expect(matchesRoute(tour.route, expected.sample)).toBe(true);
    expect(tour.steps).toHaveLength(expected.steps);
    expect(toursForRole(expected.role).map((entry) => entry.key)).toContain(expected.key);
  });

  it("points every step at a control of this page (or the portal's Help) that exists in the source", () => {
    for (const step of tour.steps) {
      expect(step.target, step.id).not.toBeNull();
      const info = TOUR_TARGETS[step.target!];
      expect(info.portal, step.id).toBe(expected.portal);
      expect([expected.route, "*"], step.id).toContain(info.page);
      expect(scan.found.has(step.target!), `${step.target} is not spread with tourTarget() in app/ components/ lib/`).toBe(true);
    }
  });

  it("keeps every step to 25 words or fewer, with a short title, at version 1", () => {
    expect(tour.version).toBe(1);
    for (const step of tour.steps) {
      expect(countWords(step.body), step.id).toBeLessThanOrEqual(25);
      expect(countWords(step.title), step.id).toBeLessThanOrEqual(5);
      expect(step.since).toBe(1);
      expect(step.practice).toBeFalsy();
    }
  });

  it("is listed in the release notes", () => {
    const covered = RELEASE_NOTES.flatMap((note) => note.items).filter((item) => item.covered?.tourKey === expected.key);
    expect(covered.length).toBeGreaterThan(0);
  });
});

describe("other roles", () => {
  it("never see the QA or maintenance page tours", () => {
    for (const role of ["ADMIN", "OPS_MANAGER", "CLEANER", "CLIENT", "VA", "LAUNDRY"] as const) {
      const keys = toursForRole(role).map((tour) => tour.key);
      for (const expected of NEW_TOURS) expect(keys).not.toContain(expected.key);
    }
  });

  it("the maintenance visit and QA inspection pages mark a running clock so no tour starts over it", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("components/v2/maintenance/visit-workspace.tsx", "utf8")).toMatch(/data-tour-busy=\{clockRunning \? "clock" : undefined\}/);
    expect(readFileSync("components/v2/qa/qa-inspection-workspace.tsx", "utf8")).toMatch(/timer\.running \? "clock"/);
  });
});
