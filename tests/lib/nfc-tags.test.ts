import { describe, it, expect } from "vitest";
import {
  resolveScanJob,
  isJobInScanWindow,
  isDuplicateScan,
  buildTagUrl,
  SCAN_OUTCOME_MESSAGE,
  SCAN_DEDUPE_MS,
  type ScanCandidateJob,
} from "@/lib/nfc/tags";

const job = (over: Partial<ScanCandidateJob> = {}): ScanCandidateJob => ({
  id: "job-1",
  status: "ASSIGNED",
  // 23:00Z on the 21st is 09:00 on the 22nd in Sydney — the offset matters in
  // several cases below, so it is baked into the fixture rather than hidden.
  scheduledDate: new Date("2026-08-21T23:00:00.000Z"),
  ...over,
});

const at = (iso: string) => new Date(iso);

describe("isJobInScanWindow", () => {
  it("accepts a cleaner who turned up early", () => {
    expect(isJobInScanWindow(job(), at("2026-08-21T19:00:00.000Z"))).toBe(true);
  });

  it("accepts a cleaner still finishing late", () => {
    expect(isJobInScanWindow(job(), at("2026-08-22T08:00:00.000Z"))).toBe(true);
  });

  it("keeps a job scheduled for today in range all day", () => {
    // An all-day booking stamped at Sydney midnight would otherwise fall out
    // of the clock window by the afternoon.
    const midnightJob = job({ scheduledDate: new Date("2026-08-21T14:00:00.000Z") });
    // 06:00Z on the 22nd = 16:00 Sydney, the same Sydney day as the job.
    expect(isJobInScanWindow(midnightJob, at("2026-08-22T06:00:00.000Z"))).toBe(true);
  });

  it("rejects a job days away", () => {
    expect(isJobInScanWindow(job(), at("2026-08-25T23:00:00.000Z"))).toBe(false);
    expect(isJobInScanWindow(job(), at("2026-08-18T23:00:00.000Z"))).toBe(false);
  });
});

describe("resolveScanJob", () => {
  const now = at("2026-08-21T23:30:00.000Z");

  it("checks a cleaner in to the job they turned up for", () => {
    const out = resolveScanJob([job()], now);
    expect(out.outcome).toBe("ACCEPTED");
    expect(out.action).toBe("CHECK_IN");
    expect(out.job?.id).toBe("job-1");
  });

  it("checks a cleaner OUT when they are already working here", () => {
    // Mid-clean at this property, a tap can only sensibly mean "finished".
    const out = resolveScanJob([job({ status: "IN_PROGRESS" })], now);
    expect(out.outcome).toBe("ACCEPTED");
    expect(out.action).toBe("CHECK_OUT");
  });

  it("treats a paused job as one to check out of, not back into", () => {
    expect(resolveScanJob([job({ status: "PAUSED" })], now).action).toBe("CHECK_OUT");
  });

  it("prefers the started job when one is running and another is waiting", () => {
    const out = resolveScanJob(
      [job({ id: "waiting", status: "ASSIGNED" }), job({ id: "running", status: "IN_PROGRESS" })],
      now
    );
    expect(out.job?.id).toBe("running");
    expect(out.action).toBe("CHECK_OUT");
  });

  it("asks rather than guessing between two startable jobs", () => {
    // Guessing clocks somebody into the wrong job — a payroll and QA problem
    // that only surfaces days later. Asking costs one tap.
    const out = resolveScanJob([job({ id: "a" }), job({ id: "b" })], now);
    expect(out.outcome).toBe("MULTIPLE_JOBS");
    expect(out.job).toBeUndefined();
  });

  it("has nothing to do when every job here is already finished", () => {
    const out = resolveScanJob([job({ status: "COMPLETED" }), job({ status: "SUBMITTED" })], now);
    expect(out.outcome).toBe("NO_JOB");
  });

  it("reports no job when nothing is near in time", () => {
    expect(resolveScanJob([job()], at("2026-08-26T23:00:00.000Z")).outcome).toBe("NO_JOB");
    expect(resolveScanJob([], now).outcome).toBe("NO_JOB");
  });
});

describe("isDuplicateScan", () => {
  const now = at("2026-08-21T23:30:00.000Z");

  it("collapses a phone that fired the same tap twice", () => {
    // Without this a double read checks someone in and straight back out.
    expect(isDuplicateScan(new Date(now.getTime() - 1_000), now)).toBe(true);
  });

  it("lets a genuine second tap through", () => {
    expect(isDuplicateScan(new Date(now.getTime() - SCAN_DEDUPE_MS - 1), now)).toBe(false);
  });

  it("has nothing to collapse on a first tap", () => {
    expect(isDuplicateScan(null, now)).toBe(false);
    expect(isDuplicateScan(undefined, now)).toBe(false);
  });

  it("treats clock skew as recent rather than ancient", () => {
    // The safe direction: an ignored tap costs a re-tap, a wrong one costs a
    // bad time record on someone's pay.
    expect(isDuplicateScan(new Date(now.getTime() + 5_000), now)).toBe(true);
  });
});

describe("buildTagUrl", () => {
  it("builds the URL that gets written onto the tag", () => {
    expect(buildTagUrl("https://app.example.com", "abc123")).toBe(
      "https://app.example.com/t/abc123"
    );
  });

  it("does not double the slash when the base carries one", () => {
    expect(buildTagUrl("https://app.example.com/", "abc123")).toBe(
      "https://app.example.com/t/abc123"
    );
  });

  it("escapes a token so it cannot break out of the path", () => {
    expect(buildTagUrl("https://app.example.com", "a/b?c")).toBe(
      "https://app.example.com/t/a%2Fb%3Fc"
    );
  });
});

describe("SCAN_OUTCOME_MESSAGE", () => {
  it("tells the cleaner what to do next for every outcome", () => {
    // They are standing at a door holding a phone. A message that only names
    // the failure leaves them stuck.
    for (const [outcome, message] of Object.entries(SCAN_OUTCOME_MESSAGE)) {
      expect(message.length, `${outcome} has no message`).toBeGreaterThan(0);
    }
  });
});
