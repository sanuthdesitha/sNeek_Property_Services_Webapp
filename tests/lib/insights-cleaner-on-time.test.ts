/**
 * Insights › Cleaners "On time" uses each cleaner's OWN first clock-in, the
 * same rule as the workforce performance page (owner report 2026-11-15: team
 * jobs must not be attributed fully to each cleaner).
 */
import { describe, expect, it } from "vitest";
import { cleanerRows } from "@/lib/insights/entities";
import { deriveJobFact } from "@/lib/insights/job-facts";
import { context, jobRow } from "./insights-fixtures";

const ANA = { userId: "cleaner-1", payRate: 30, removedAt: null, user: { name: "Ana", email: null, role: "CLEANER", hourlyRate: null } };
const BEN = { userId: "cleaner-2", payRate: 30, removedAt: null, user: { name: "Ben", email: null, role: "CLEANER", hourlyRate: null } };

describe("Insights cleaner rows: on time per cleaner", () => {
  it("a teammate's early clock-in does not make a late cleaner on time", () => {
    const facts = [1, 2, 3].map((n) =>
      deriveJobFact(
        jobRow({
          id: `team-${n}`,
          assignments: [ANA, BEN],
          timeLogs: [
            // Ana 10:05 Sydney (on time), Ben 10:40 (late), start 10:00.
            { userId: "cleaner-1", startedAt: new Date("2026-10-04T23:05:00Z"), stoppedAt: new Date("2026-10-05T01:00:00Z"), durationM: 115 },
            { userId: "cleaner-2", startedAt: new Date("2026-10-04T23:40:00Z"), stoppedAt: new Date("2026-10-05T01:00:00Z"), durationM: 80 },
          ],
        }),
        context,
      ),
    );
    // The company figure still reads the job's first clock-in.
    expect(facts.every((fact) => fact.onTime.value === true)).toBe(true);
    const rows = cleanerRows(facts, { total: 0, byCleaner: new Map(), byProperty: new Map(), byCategory: new Map() }, new Map([["cleaner-1", "Ana"], ["cleaner-2", "Ben"]]), { fromKey: "2026-10-01", toKey: "2026-10-31" });
    const ana = rows.find((row) => row.id === "cleaner-1")!;
    const ben = rows.find((row) => row.id === "cleaner-2")!;
    expect(ana.figures.onTime.value).toBe(100);
    expect(ben.figures.onTime.value).toBe(0);
  });

  it("a cleaner without their own clock-in is left out, not on time", () => {
    const facts = [1, 2, 3].map((n) =>
      deriveJobFact(jobRow({ id: `solo-${n}`, assignments: [ANA, BEN] }), context),
    );
    const rows = cleanerRows(facts, { total: 0, byCleaner: new Map(), byProperty: new Map(), byCategory: new Map() }, new Map(), { fromKey: "2026-10-01", toKey: "2026-10-31" });
    const ben = rows.find((row) => row.id === "cleaner-2")!;
    expect(ben.figures.onTime.value).toBeNull();
  });
});
