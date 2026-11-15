import { describe, expect, it } from "vitest";
import { TOURS } from "@/lib/tutorials/registry";
import { TOUR_TARGETS } from "@/lib/tutorials/targets";
import { countWords } from "@/lib/tutorials/engine";

describe("tour registry rules", () => {
  it("has unique tour keys and unique step ids per tour", () => {
    expect(new Set(TOURS.map((tour) => tour.key)).size).toBe(TOURS.length);
    for (const tour of TOURS) expect(new Set(tour.steps.map((step) => step.id)).size, tour.key).toBe(tour.steps.length);
  });

  it.each(TOURS.flatMap((tour) => tour.steps.map((step) => [tour.key, step.id, step.body] as const)))("%s › %s has at most 25 words", (_tour, _step, body) => {
    expect(countWords(body)).toBeLessThanOrEqual(25);
  });

  it("keeps every step's What's new version within the tour version", () => {
    for (const tour of TOURS) for (const step of tour.steps) expect(step.since).toBeLessThanOrEqual(tour.version);
  });

  it("points steps only at targets of the tour's own portal", () => {
    for (const tour of TOURS) {
      for (const step of tour.steps) if (step.target) expect(TOUR_TARGETS[step.target].portal, `${tour.key} › ${step.id}`).toBe(tour.portal);
    }
  });

  it("labels every practice walkthrough with a banner and an exit, and its practice steps on practice routes", () => {
    for (const tour of TOURS.filter((entry) => entry.steps.some((step) => step.practice))) {
      expect(tour.kind, tour.key).toBe("walkthrough");
      expect(tour.practice?.banner, tour.key).toMatch(/^Practice · /);
      expect(tour.practice?.exitHref).toBeTruthy();
      for (const step of tour.steps.filter((entry) => entry.practice)) expect((step.route ?? tour.route).includes("/practice")).toBe(true);
    }
  });

  it("welcome screens are centred cards, one per role", () => {
    const welcomes = TOURS.filter((tour) => tour.kind === "welcome");
    for (const tour of welcomes) for (const step of tour.steps) expect(step.target).toBeNull();
    const roles = welcomes.flatMap((tour) => tour.roles);
    expect(new Set(roles).size).toBe(roles.length);
    expect(roles.sort()).toEqual(["ADMIN", "CLEANER", "CLIENT", "LAUNDRY", "MAINTENANCE", "OPS_MANAGER", "QA_INSPECTOR", "VA"]);
  });

  it("offers only walkthroughs that exist for the same roles", () => {
    for (const tour of TOURS.filter((entry) => entry.offerWalkthrough)) {
      const offered = TOURS.find((entry) => entry.key === tour.offerWalkthrough);
      expect(offered?.kind).toBe("walkthrough");
    }
  });
});
