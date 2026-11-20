/**
 * Property devices (2026-11-20) on the cleaner's surfaces: a high-priority
 * task leads the Read first block and is never folded; the combined reminder
 * email lists the charge line, escaped.
 */
import { describe, expect, it } from "vitest";
import { buildReadFirstItems, isPriorityTask } from "@/components/v2/cleaner/read-first-block";
import { digestJobList, type ReminderDigestJob } from "@/lib/email-design/reminder-digest";

const chargeTask = { id: "t1", title: "Charge the Ring camera: Front door (18%)", description: "Battery is at 18%.", metadata: { kind: "DEVICE_CHARGE", priority: "HIGH", deviceId: "d1" }, attachments: [] };
const plainTask = { id: "t2", title: "Wipe the balcony glass", metadata: { allowNotApplicable: false }, attachments: [] };

describe("Read first", () => {
  it("puts a high-priority task in its own always-visible source, ahead of other tasks, and not twice", () => {
    const items = buildReadFirstItems({ jobMeta: { internalNoteText: "Gate sticks" }, jobTasks: [plainTask, chargeTask] });
    expect(items.map((item) => item.source)).toEqual(["PRIORITY", "ADMIN", "TASK"]);
    expect(items[0].title).toBe(chargeTask.title);
    expect(items.filter((item) => item.title === chargeTask.title)).toHaveLength(1);
    expect(isPriorityTask(chargeTask)).toBe(true);
    expect(isPriorityTask(plainTask)).toBe(false);
  });
});

describe("combined reminder email", () => {
  it("lists the device charge line under its job, escaped", () => {
    const job: ReminderDigestJob = {
      jobId: "j1", jobReference: "J-1", propertyName: "Bondi", propertyAddress: "1 Ocean St", jobTypeLabel: "AIRBNB TURNOVER",
      dayLabel: "Fri 20 Nov", timeLabel: "10:00", timingLines: [], priorityLines: ["High priority: Charge the Ring camera: <Front> (18%)"], jobUrl: "/cleaner/jobs/j1", sortAt: 1,
    };
    const list = digestJobList([job]);
    expect(list.html).toContain("High priority: Charge the Ring camera: &lt;Front&gt; (18%)");
    expect(list.text).toContain("High priority: Charge the Ring camera: <Front> (18%)");
  });
});
