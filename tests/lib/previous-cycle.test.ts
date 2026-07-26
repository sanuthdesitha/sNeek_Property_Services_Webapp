import { describe, expect, it } from "vitest";
import { pickDropConfirmation, pickPreviousCleanJob } from "@/lib/laundry/previous-cycle";

const PROPERTY = "prop-1";
const CURRENT_JOB = "job-current";
const CURRENT_DATE = new Date("2026-07-06T00:00:00Z");

function candidate(overrides: Partial<Parameters<typeof pickPreviousCleanJob>[0][number]> = {}) {
  return {
    id: "job-a",
    propertyId: PROPERTY,
    jobType: "AIRBNB_TURNOVER",
    isRework: false,
    scheduledDate: new Date("2026-07-03T00:00:00Z"),
    laundryTask: { id: "task-a" },
    ...overrides,
  };
}

describe("pickPreviousCleanJob", () => {
  it("picks the latest prior clean at the property that HAS a laundry task", () => {
    const older = candidate({ id: "job-old", scheduledDate: new Date("2026-06-28T00:00:00Z") });
    const latest = candidate({ id: "job-latest", scheduledDate: new Date("2026-07-03T00:00:00Z") });
    const result = pickPreviousCleanJob([older, latest], {
      propertyId: PROPERTY,
      currentJobId: CURRENT_JOB,
      currentJobScheduledDate: CURRENT_DATE,
    });
    expect(result?.id).toBe("job-latest");
  });

  it("skips jobs without a laundry task, falling back to an older clean that has one", () => {
    const withTask = candidate({ id: "job-with-task", scheduledDate: new Date("2026-06-30T00:00:00Z") });
    const noTask = candidate({
      id: "job-no-task",
      scheduledDate: new Date("2026-07-03T00:00:00Z"),
      laundryTask: null,
    });
    const result = pickPreviousCleanJob([noTask, withTask], {
      propertyId: PROPERTY,
      currentJobId: CURRENT_JOB,
      currentJobScheduledDate: CURRENT_DATE,
    });
    expect(result?.id).toBe("job-with-task");
  });

  it("skips reworks, the current job, other properties, other job types, and later cleans", () => {
    const rework = candidate({ id: "job-rework", isRework: true });
    const current = candidate({ id: CURRENT_JOB });
    const otherProperty = candidate({ id: "job-other-prop", propertyId: "prop-2" });
    const otherType = candidate({ id: "job-deep", jobType: "DEEP_CLEAN" });
    const future = candidate({ id: "job-future", scheduledDate: new Date("2026-07-09T00:00:00Z") });
    const sameDay = candidate({ id: "job-same-day", scheduledDate: CURRENT_DATE });
    const result = pickPreviousCleanJob(
      [rework, current, otherProperty, otherType, future, sameDay],
      { propertyId: PROPERTY, currentJobId: CURRENT_JOB, currentJobScheduledDate: CURRENT_DATE },
    );
    expect(result).toBeNull();
  });

  it("still finds the valid clean among invalid candidates", () => {
    const valid = candidate({ id: "job-valid", scheduledDate: new Date("2026-07-01T00:00:00Z") });
    const result = pickPreviousCleanJob(
      [candidate({ id: "job-rework", isRework: true }), valid, candidate({ id: "x", propertyId: "prop-9" })],
      { propertyId: PROPERTY, currentJobId: CURRENT_JOB, currentJobScheduledDate: CURRENT_DATE },
    );
    expect(result?.id).toBe("job-valid");
  });
});

function confirmation(
  id: string,
  createdAt: string,
  notes: string | null,
  extra: Partial<{ photoUrl: string | null; s3Key: string | null; bagLocation: string | null }> = {},
) {
  return { id, createdAt: new Date(createdAt), notes, photoUrl: null, s3Key: null, bagLocation: null, ...extra };
}

describe("pickDropConfirmation", () => {
  it("selects the DROPPED-event confirmation, ignoring cleaner proofs and pickups", () => {
    const rows = [
      confirmation("c1", "2026-07-04T09:00:00Z", null, { photoUrl: "cleaner.jpg" }),
      confirmation("c2", "2026-07-04T12:00:00Z", JSON.stringify({ event: "PICKED_UP" })),
      confirmation("c3", "2026-07-05T10:00:00Z", JSON.stringify({ event: "DROPPED" }), {
        photoUrl: "drop.jpg",
      }),
    ];
    expect(pickDropConfirmation(rows)?.id).toBe("c3");
  });

  it("is tolerant of reverts — the latest DROPPED wins over reverted/earlier drops", () => {
    const rows = [
      confirmation("drop-1", "2026-07-05T08:00:00Z", JSON.stringify({ event: "DROPPED" })),
      confirmation("revert", "2026-07-05T09:00:00Z", JSON.stringify({ event: "REVERT_TO_PICKED_UP" })),
      confirmation("drop-2", "2026-07-05T11:00:00Z", JSON.stringify({ event: "DROPPED" }), {
        s3Key: "drops/redrop.jpg",
      }),
    ];
    const picked = pickDropConfirmation(rows);
    expect(picked?.id).toBe("drop-2");
    expect(picked?.s3Key).toBe("drops/redrop.jpg");
  });

  it("handles unsorted input, non-JSON notes, empty and missing lists", () => {
    const rows = [
      confirmation("late-drop", "2026-07-05T15:00:00Z", JSON.stringify({ event: "DROPPED" })),
      confirmation("plain", "2026-07-05T16:00:00Z", "left at the front door"),
      confirmation("early-drop", "2026-07-05T09:00:00Z", JSON.stringify({ event: "DROPPED" })),
    ];
    expect(pickDropConfirmation(rows.reverse())?.id).toBe("late-drop");
    expect(pickDropConfirmation([])).toBeNull();
    expect(pickDropConfirmation(null)).toBeNull();
    expect(pickDropConfirmation(undefined)).toBeNull();
  });
});
