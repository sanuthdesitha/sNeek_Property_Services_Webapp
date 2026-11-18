// @vitest-environment node
/**
 * The combined reminder email (lib/email-design/reminder-digest.ts and
 * catalog/reminders.ts): a block design per reminder type, an escaped job
 * list with a plain-text twin, and sentences from the type's wording.
 */
import { describe, expect, it } from "vitest";
import { buildReminderDigestEmail, digestDayList, digestJobList, sortDigestJobs, type ReminderDigestJob } from "@/lib/email-design/reminder-digest";
import { findEmailDesign, allDesignsForType } from "@/lib/email-design/all-designs";
import { composeDesign } from "@/lib/email-design/compose";
import { DEFAULT_EMAIL_THEME } from "@/lib/email-design/theme";
import { defaultNotificationWording } from "@/lib/notifications/wording/render";
import { reminderDigestTexts } from "@/lib/notifications/wording/reminder-digest";

const settings = { companyName: "sNeek Property Services" };

function row(id: string, sortAt: number, over: Partial<ReminderDigestJob> = {}): ReminderDigestJob {
  return {
    jobId: id, jobReference: `J-${id}`, propertyName: `Property ${id}`, propertyAddress: `${id} Street`, jobTypeLabel: "AIRBNB TURNOVER",
    dayLabel: "Thu 19 Nov", timeLabel: "10:00", timingLines: [], jobUrl: `https://app.test/cleaner/jobs/${id}`, sortAt, ...over,
  };
}

describe("combined reminder email", () => {
  it("is a design for each reminder type, listed under the type in the email editor", () => {
    for (const [key, typeKey] of [["jobReminderDigest", "job.reminder.scheduled"], ["jobDayReminderDigest", "job.cleaner_day_reminder"], ["jobManualReminderDigest", "job.reminder.manual"]]) {
      const definition = findEmailDesign(key)!;
      expect(definition).toMatchObject({ typeKey, group: "cleaners", preferences: "cleaner", security: false });
      expect(allDesignsForType(typeKey).map((design) => design.key)).toContain(key);
      expect(definition.variables.find((variable) => variable.name === "jobsList")).toMatchObject({ format: "built", required: true, textTwin: "jobsText" });
      // The preview renders from the invented samples.
      const sample = Object.fromEntries(definition.samples[0] ? Object.entries(definition.samples[0].values) : []);
      const preview = composeDesign(definition, definition.defaults, sample, { theme: DEFAULT_EMAIL_THEME, business: { companyName: "sNeek", abn: "", address: "", phone: "", contactEmail: "", logoUrl: "", logoDarkUrl: "" }, appUrl: "https://app.test", mode: "preview", settings });
      expect(preview.missing).toEqual([]);
      expect(preview.html).toContain("The Bondi Studio");
    }
  });

  it("lists jobs by date then start time, escaped, each with its timing lines and link", () => {
    const jobs = [
      row("c", 300, { dayLabel: "Fri 20 Nov" }),
      row("a", 100, { propertyName: "Bondi <Studio> & Co", timingLines: ["Late checkout: start after 11:00", "Same-day check-in: guests arrive 14:00"] }),
      row("b", 200, { jobUrl: "javascript:alert(1)" }),
    ];
    const list = digestJobList(jobs);
    expect(sortDigestJobs(jobs).map((job) => job.jobId)).toEqual(["a", "b", "c"]);
    expect(list.html).toContain("Bondi &lt;Studio&gt; &amp; Co");
    expect(list.html).not.toContain("<Studio>");
    expect(list.html).toContain("Late checkout: start after 11:00");
    expect(list.html).toContain('href="https://app.test/cleaner/jobs/a"');
    expect(list.html).not.toContain("javascript:");
    expect(list.text.split("\n\n")).toHaveLength(3);
    expect(list.text).toContain("   Same-day check-in: guests arrive 14:00");
    expect(list.text).toContain("Open job: https://app.test/cleaner/jobs/c");
    expect(digestDayList(jobs)).toBe("Thu 19 Nov, Fri 20 Nov");
  });

  it("builds a sendable email with the type's default wording and a text part that keeps one line per fact", () => {
    const jobs = [row("a", 100), row("b", 200), row("c", 300, { dayLabel: "Fri 20 Nov" })];
    const wording = defaultNotificationWording("job.reminder.scheduled");
    const texts = reminderDigestTexts(wording, { userName: "Jane <J>", jobCount: 3, dayList: digestDayList(jobs) });
    expect(texts.subject).toBe("Your 3 upcoming jobs (Thu 19 Nov, Fri 20 Nov)");
    expect(texts.headingHtml).toBe("Job reminder — your next 3 jobs");
    expect(texts.introHtml).toContain("Hello Jane &lt;J&gt;");
    const email = buildReminderDigestEmail(settings, { kind: "scheduled", jobs, texts, actionUrl: "https://app.test/cleaner/jobs" });
    expect(email.missing).toEqual([]);
    expect(email.jobIds).toEqual(["a", "b", "c"]);
    expect(email.subject).toBe(texts.subject);
    expect(email.text).toContain("1. Property a — a Street\n   Thu 19 Nov · 10:00 · AIRBNB TURNOVER · J-a");
    expect(email.html).toContain("Open my jobs");
  });

  it("each reminder type has its own editable digest wording", () => {
    for (const [typeKey, subject] of [
      ["job.reminder.scheduled", "Your 2 upcoming jobs (Thu 19 Nov)"],
      ["job.cleaner_day_reminder", "Your 2 jobs today (Thu 19 Nov)"],
      ["job.reminder.manual", "Reminder: 2 unfinished jobs"],
    ]) {
      const texts = reminderDigestTexts(defaultNotificationWording(typeKey), { userName: "Jane", jobCount: 2, dayList: "Thu 19 Nov" });
      expect(texts.subject).toBe(subject);
      expect(texts.buttonLabel.length).toBeGreaterThan(0);
    }
    const manual = reminderDigestTexts(defaultNotificationWording("job.reminder.manual"), { userName: "Jane", jobCount: 2, dayList: "", note: "Bring <keys>" });
    expect(manual.noteHtml).toBe("Note from admin: Bring &lt;keys&gt;");
  });
});
