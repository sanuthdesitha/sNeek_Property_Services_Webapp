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
  expect(mergeTrackedPosition([current], { ...current, lat: 3, timestamp: "2026-10-09T10:00:15Z" })[0]).toMatchObject({ lat: 3, activeJob: { id: "job" }, positionSource: "gps", stale: false });
});
