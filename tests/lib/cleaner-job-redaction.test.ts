// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  redactJobForCleaner,
  redactJobMetaForCleaner,
  redactTransferCandidates,
} from "@/lib/jobs/cleaner-redaction";

const job = {
  id: "job", status: "ASSIGNED", fixedPrice: 420, internalNotes: '{"cleanerPayouts":{"other":90}}', reworkPayAmount: 35,
  assignments: [
    { id: "a1", userId: "me", payRate: 38, responseNote: "ok", user: { id: "me", name: "Me", email: "me@example.test" } },
    { id: "a2", userId: "other", payRate: 45, responseNote: "private", responseStatus: "ACCEPTED", user: { id: "other", name: "Sam", email: "sam@example.test" } },
  ],
  qaAssignments: [{ id: "q", assignedTo: { id: "qa", name: "Quinn", email: "quinn@example.test" } }],
  property: { name: "Bondi", client: { id: "c", name: "Harbour View", email: "owner@example.test" } },
  laundryTask: { id: "l", status: "PENDING", adminOverrideNote: "office only" },
};

describe("a job as a cleaner receives it", () => {
  const seen = redactJobForCleaner(job, "me") as any;

  it("removes the client price and the office's raw notes", () => {
    expect(seen).not.toHaveProperty("fixedPrice");
    expect(seen).not.toHaveProperty("internalNotes");
    expect(seen).not.toHaveProperty("reworkPayAmount");
  });

  it("keeps the cleaner's own assignment intact", () => {
    expect(seen.assignments[0]).toEqual(job.assignments[0]);
  });

  it("keeps a colleague's name and acceptance but not their pay, note or contact", () => {
    expect(seen.assignments[1]).toEqual({
      id: "a2", userId: "other", responseStatus: "ACCEPTED", user: { id: "other", name: "Sam" },
    });
  });

  it("removes the client's and the inspector's email and the office laundry note", () => {
    expect(seen.property.client).toEqual({ id: "c", name: "Harbour View" });
    expect(seen.qaAssignments[0].assignedTo).toEqual({ id: "qa", name: "Quinn" });
    expect(seen.laundryTask).toEqual({ id: "l", status: "PENDING" });
  });

  it("leaves working details and the original object untouched", () => {
    expect(seen.status).toBe("ASSIGNED");
    expect(seen.property.name).toBe("Bondi");
    expect(job.fixedPrice).toBe(420);
    expect(job.assignments[1].payRate).toBe(45);
  });
});

describe("job notes as a cleaner receives them", () => {
  it("shows only their own payout and allowance", () => {
    const meta = { tags: ["x"], cleanerPayouts: { me: 120, other: 90 }, transportAllowances: { other: 15 } };
    expect(redactJobMetaForCleaner(meta, "me")).toEqual({
      tags: ["x"], cleanerPayouts: { me: 120 }, transportAllowances: {},
    });
  });
});

describe("people a job can be handed to", () => {
  it("offers a name and never an email address", () => {
    expect(redactTransferCandidates([
      { id: "1", name: "Sam", email: "sam@example.test" },
      { id: "2", name: " ", email: "nameless@example.test" },
    ])).toEqual([{ id: "1", name: "Sam" }, { id: "2", name: "Cleaner" }]);
  });
});
