import { expect, it } from "vitest";
import { readJobsScrollPositions, jobsScrollContentFingerprint } from "@/lib/jobs/scroll-restoration";
it.each([null, "not-json", "{}", "null", "[null,3,\"bad\"]", "x".repeat(200001)])("rejects malformed saved scroll data", raw => {
  expect(readJobsScrollPositions(raw)).toEqual([]);
});
it("caps retained records and distinguishes changed content", () => {
  const row = { scope: "account/filter", content: "fingerprint", x: 0, y: 0, width: 100, height: 100, savedAt: 1000 };
  expect(readJobsScrollPositions(JSON.stringify(Array(30).fill(row)), 1000)).toHaveLength(20);
  expect(jobsScrollContentFingerprint("job one")).not.toBe(jobsScrollContentFingerprint("job two"));
});
