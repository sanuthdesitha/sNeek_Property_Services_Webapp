import { describe, it, expect } from "vitest";
import { pickAuthoritativeReviews } from "@/lib/qa/review-dedupe";

/**
 * The double-submit bug left some jobs with several QAReview rows; any feed
 * listing them raw showed the cleaner two verdicts for one clean. These pin
 * the pick: QA outranks ADMIN, newest wins within a kind, other jobs' reviews
 * are untouched.
 */

const r = (id: string, jobId: string, kind: string, createdAt: string) => ({
  id,
  jobId,
  kind,
  createdAt: new Date(createdAt),
});

describe("pickAuthoritativeReviews", () => {
  it("collapses duplicate reviews of one job to a single row", () => {
    const rows = [
      r("b", "job-1", "QA", "2026-07-23T10:00:05Z"), // the double-submit copy
      r("a", "job-1", "QA", "2026-07-23T10:00:00Z"),
    ];
    const out = pickAuthoritativeReviews(rows);
    expect(out).toHaveLength(1);
    // Newest within the same kind wins.
    expect(out[0].id).toBe("b");
  });

  it("prefers a real inspection over an admin quick score, regardless of age", () => {
    const rows = [
      r("admin-new", "job-1", "ADMIN", "2026-07-23T12:00:00Z"),
      r("qa-old", "job-1", "QA", "2026-07-20T09:00:00Z"),
    ];
    const out = pickAuthoritativeReviews(rows);
    expect(out.map((x) => x.id)).toEqual(["qa-old"]);
  });

  it("keeps one review per job and preserves the input's relative order", () => {
    const rows = [
      r("j2", "job-2", "ADMIN", "2026-07-23T11:00:00Z"),
      r("j1-dupe", "job-1", "QA", "2026-07-23T10:00:05Z"),
      r("j1", "job-1", "QA", "2026-07-23T10:00:00Z"),
      r("j3", "job-3", "QA", "2026-07-22T10:00:00Z"),
    ];
    expect(pickAuthoritativeReviews(rows).map((x) => x.id)).toEqual(["j2", "j1-dupe", "j3"]);
  });

  it("passes a clean list through unchanged", () => {
    const rows = [
      r("x", "job-1", "QA", "2026-07-23T10:00:00Z"),
      r("y", "job-2", "ADMIN", "2026-07-22T10:00:00Z"),
    ];
    expect(pickAuthoritativeReviews(rows)).toEqual(rows);
  });

  it("tolerates string dates and unknown kinds without crashing", () => {
    const rows = [
      { id: "a", jobId: "job-1", kind: null, createdAt: "2026-07-23T10:00:00Z" },
      { id: "b", jobId: "job-1", kind: "ADMIN", createdAt: "2026-07-20T10:00:00Z" },
    ];
    // A known kind outranks an unknown one even when older.
    expect(pickAuthoritativeReviews(rows).map((x) => x.id)).toEqual(["b"]);
  });
});
