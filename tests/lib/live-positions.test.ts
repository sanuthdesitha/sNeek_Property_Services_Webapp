import { expect, it } from "vitest";
import { mergeTrackedPosition } from "@/lib/ops/live-positions";
const current = { userId: "cleaner", lat: 1, lng: 2, timestamp: "2026-10-09T10:00:00Z", activeJob: { id: "job" } };
it("does not introduce workers without active work from delayed raw GPS", () => {
  const rows = [current];
  expect(mergeTrackedPosition(rows, { ...current, userId: "off-duty" })).toBe(rows);
});
it("rejects out-of-order and invalid measurements", () => {
  const rows = [current];
  for (const timestamp of ["2026-10-09T09:59:00Z", "invalid", null]) expect(mergeTrackedPosition(rows, { ...current, timestamp })).toBe(rows);
});
it("updates a tracked position while preserving the enriched job context", () => {
  // Staleness is now judged from the fix's measured time (live location 2026-11): pass "now".
  const now = Date.parse("2026-10-09T10:01:00Z");
  expect(mergeTrackedPosition([current], { ...current, lat: 3, timestamp: "2026-10-09T10:00:15Z" }, now)[0]).toMatchObject({ lat: 3, activeJob: { id: "job" }, positionSource: "gps", stale: false });
});
it("keeps a late-flushed backlog fix marked stale and drops an old accuracy", () => {
  const now = Date.parse("2026-10-09T10:20:00Z");
  const merged = mergeTrackedPosition([{ ...current, accuracy: 5 }], { ...current, lat: 3, timestamp: "2026-10-09T10:05:00Z", accuracy: null }, now)[0];
  expect(merged).toMatchObject({ lat: 3, stale: true, accuracy: null });
});
