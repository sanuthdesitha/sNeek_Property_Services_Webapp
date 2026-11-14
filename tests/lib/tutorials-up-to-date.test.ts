import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TOURS, findTour } from "@/lib/tutorials/registry";
import { TOUR_TARGETS } from "@/lib/tutorials/targets";
import { scanTourTargets } from "@/lib/tutorials/source-scan";
import { tourFingerprint, type FingerprintFile } from "@/lib/tutorials/fingerprint";
import { RELEASE_NOTES } from "@/lib/tutorials/releases";

/**
 * Staying up to date (owner requirement, board "Tutorials"): a tour can never
 * point at a control that no longer exists, and a page with a tour cannot
 * change its registered controls without the tour being updated.
 */
const ROOT = process.cwd();
const scan = scanTourTargets(ROOT);
const fingerprints: FingerprintFile = JSON.parse(readFileSync(join(ROOT, "lib/tutorials/fingerprints.json"), "utf8"));

const HOW_TO_FIX = [
  "A page with a tour changed its registered tour targets (or a step changed) without updating the tour.",
  "Fix it in the same change, one of:",
  "  1. Visible change: bump the tour's `version` in lib/tutorials/registry.ts, set `since: <new version>` on each",
  "     new or changed step (people who finished see only those steps as What's new), add a line to",
  "     lib/tutorials/releases.ts, then run `npx tsx scripts/tutorials/update-fingerprints.ts`.",
  "  2. No visible change (speed, refactor): run",
  "     `npx tsx scripts/tutorials/update-fingerprints.ts --no-visible-change <tourKey> \"<reason>\" \"<your name>\"`.",
  "     The reason is shown to administrators in Settings › System › Tutorials.",
].join("\n");

describe("every tour step points at a control that exists in the source", () => {
  it.each(TOURS.flatMap((tour) => tour.steps.filter((step) => step.target).map((step) => [tour.key, step.id, step.target!] as const)))(
    "%s › %s → %s",
    (_tour, _step, target) => {
      expect(Object.prototype.hasOwnProperty.call(TOUR_TARGETS, target), `${target} is not in lib/tutorials/targets.ts`).toBe(true);
      expect(scan.found.has(target), `No control spreads tourTarget("${target}"). Restore the target on the control, or update the tour.`).toBe(true);
    },
  );

  it("only registered ids are used in the source", () => {
    const unknown = Array.from(scan.found).filter((id) => !Object.prototype.hasOwnProperty.call(TOUR_TARGETS, id));
    expect(unknown).toEqual([]);
  });
});

describe("a page with a tour cannot change without its tour", () => {
  it.each(TOURS.map((tour) => [tour.key] as const))("%s matches its checked-in fingerprint", (key) => {
    const tour = findTour(key)!;
    const entry = fingerprints[key];
    const fingerprint = tourFingerprint(tour, scan.found);
    expect(entry, `No fingerprint for ${key}. Run \`npx tsx scripts/tutorials/update-fingerprints.ts\`.`).toBeDefined();
    expect(tour.version, `${key}: the version went down (${entry.version} → ${tour.version}).`).toBeGreaterThanOrEqual(entry.version);
    if (tour.version > entry.version) {
      const hasWhatsNew = tour.steps.some((step) => step.since === tour.version);
      expect(hasWhatsNew, `${key} v${tour.version}: no step has since: ${tour.version}. Add or adjust a What's new step.`).toBe(true);
      throw new Error(`${key}: version bumped to ${tour.version}; record it with \`npx tsx scripts/tutorials/update-fingerprints.ts\`.`);
    }
    const accepted = entry.fingerprint === fingerprint || (entry.noVisibleChange ?? []).some((note) => note.fingerprint === fingerprint && note.reason.trim().length > 0);
    expect(accepted, `${key}: fingerprint ${fingerprint} ≠ ${entry.fingerprint}.\n${HOW_TO_FIX}`).toBe(true);
  });

  it("detects a change: a new target on the Jobs page changes the Jobs fingerprint", () => {
    const jobs = findTour("admin.jobs")!;
    const without = new Set(scan.found);
    without.delete("admin.jobs.bulk");
    expect(tourFingerprint(jobs, without)).not.toBe(tourFingerprint(jobs, scan.found));
  });

  it("detects a change: an edited step changes the fingerprint", () => {
    const jobs = findTour("admin.jobs")!;
    const edited = { ...jobs, steps: jobs.steps.map((step) => (step.id === "row" ? { ...step, target: "admin.jobs.new" as const } : step)) };
    expect(tourFingerprint(edited, scan.found)).not.toBe(tourFingerprint(jobs, scan.found));
  });

  it("every 'no visible change' note has a reason administrators can read", () => {
    for (const entry of Object.values(fingerprints)) {
      for (const note of entry.noVisibleChange ?? []) expect(note.reason.trim().length).toBeGreaterThan(3);
    }
  });

  it("release notes name real tours and steps", () => {
    for (const note of RELEASE_NOTES) {
      for (const item of note.items) {
        expect(Boolean(item.covered) || Boolean(item.noVisibleChange?.trim())).toBe(true);
        if (item.covered) {
          const tour = findTour(item.covered.tourKey);
          expect(tour, item.covered.tourKey).toBeDefined();
          for (const id of item.covered.stepIds) expect(tour!.steps.some((step) => step.id === id)).toBe(true);
        }
      }
    }
  });
});
