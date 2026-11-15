// @vitest-environment node
/**
 * Parity: with no override, the wording layer renders byte-identical text to
 * what each producer composed before it existed. Each "legacy" function below
 * is the original composition copied verbatim from the producer (git HEAD
 * before the wording layer), run on the same inputs as the new render.
 */
import { vi, describe, expect, it } from "vitest";
// The body composition is what these tests pin; the block-design spec the send path uses is tested in email-design-wording.test.ts.
vi.mock("@/lib/email-design/wording-bridge", () => ({ attachWordingDesign: (html: string) => html }));
import { escapeHtml } from "@/lib/utils/escape-html";
import { defaultNotificationWording } from "@/lib/notifications/wording/render";

type Opt = string | null | undefined;
const cases: Array<{ note: Opt; timing: string }> = [
  { note: "Key in the lockbox", timing: "Guests arrive 14:00 | Early check-out" },
  { note: null, timing: "" },
  { note: "Use the side gate", timing: "" },
];

describe("job.cancelled / job.cancel_restored", () => {
  it("renders the original inbox notices", () => {
    const job = { propertyName: "Manly Loft", dayLabel: "Thu 13 Nov", jobNumber: "J-1061" };
    const cancelled = defaultNotificationWording("job.cancelled").render("cleaner", "INBOX", { propertyName: job.propertyName, day: job.dayLabel, jobNumber: job.jobNumber, reason: "Owner cancelled" });
    expect(cancelled.title).toBe("Job cancelled");
    expect(cancelled.body).toBe(`The job at ${job.propertyName} on ${job.dayLabel} (${job.jobNumber}) has been cancelled. You no longer need to attend. Reason: ${"Owner cancelled"}`);
    const restored = defaultNotificationWording("job.cancel_restored").render("cleaner", "INBOX", { propertyName: job.propertyName, day: job.dayLabel, jobNumber: job.jobNumber });
    expect(restored.title).toBe("Cancelled job is back on");
    expect(restored.body).toBe(`The job at ${job.propertyName} on ${job.dayLabel} (${job.jobNumber}) was cancelled and is now back on your list. Open it to confirm.`);
  });
});

describe("job.reminder.manual", () => {
  const propertyName = "Manly Loft";
  const whenLabel = "Thu 13 Nov 2026 10:00";
  const jobsUrl = "https://app.example.invalid/cleaner/jobs?a=1&b=2";
  function legacyEmail(name: string, note: Opt) {
    const safeProperty = escapeHtml(propertyName);
    const safeWhen = escapeHtml(whenLabel);
    const safeNote = note ? escapeHtml(note) : null;
    return `
              <p>Hi ${escapeHtml(name)},</p>
              <p>You have an unfinished job at <strong>${safeProperty}</strong> scheduled <strong>${safeWhen}</strong> — please open it and submit your checklist.</p>
              ${safeNote ? `<p><em>Note from admin:</em> ${safeNote}</p>` : ""}
              <p><a href="${escapeHtml(jobsUrl)}">Open your jobs</a></p>
              <p>— sNeek Ops</p>
            `;
  }
  it.each(cases)("inbox, push and email are unchanged (note: $note)", ({ note }) => {
    const wording = defaultNotificationWording("job.reminder.manual");
    const inbox = wording.render("cleaner", "INBOX", { propertyName, when: whenLabel, noteSentence: wording.line("note-line", "INBOX", { note }, Boolean(note)) });
    expect(inbox.title).toBe("Unfinished job reminder");
    expect(inbox.body).toBe(`You have an unfinished job at ${propertyName} scheduled ${whenLabel} — please open it and submit your checklist.${note ? ` Note from admin: ${note}` : ""}`);
    const email = wording.render("cleaner", "EMAIL", { recipientName: "Ana <B>", propertyName, when: whenLabel, jobNumber: "J-1", noteParagraph: wording.line("note-paragraph", "EMAIL", { note }, Boolean(note)), jobsUrl });
    expect(email.subject).toBe(`Reminder: unfinished job at ${propertyName} (J-1)`);
    expect(email.html).toBe(legacyEmail("Ana <B>", note));
  });
});

describe("job.reminder.scheduled (2-hour SMS)", () => {
  it.each(cases)("SMS is unchanged (timing: $timing)", ({ timing }) => {
    const wording = defaultNotificationWording("job.reminder.scheduled");
    const job = { startTime: "10:00" as string | null, property: { name: "Manly Loft", address: "12 Fairlight St" } };
    const legacy = `sNeek Ops: Your cleaning job at ${job.property.name} starts soon (${job.startTime ?? "today"}). ${job.property.address}.${timing ? ` ${timing}.` : ""}`;
    const sms = wording.render("cleaner", "SMS", { propertyName: job.property.name, when: job.startTime ?? "today", propertyAddress: job.property.address, timingSuffix: wording.line("timing-line", "SMS", { timingFlags: timing }, Boolean(timing)) });
    expect(sms.body).toBe(legacy);
  });
});

describe("job.reminder.unfinished_daily", () => {
  it("inbox and push are unchanged", () => {
    const body = defaultNotificationWording("job.reminder.unfinished_daily").render("cleaner", "INBOX", { jobNumber: "J-9", propertyName: "your job", status: "in progress" });
    expect(body.title).toBe("Unfinished job reminder");
    expect(body.body).toBe(`${"J-9"}: ${"your job"} is still unfinished (${"in progress"}). Please open it and submit your checklist.`);
  });
});

describe("job.cleaner_day_reminder", () => {
  it.each(cases)("inbox, email and SMS are unchanged (timing: $timing)", ({ timing }) => {
    const job = { property: { name: "Manly Loft", address: "12 Fairlight St, Manly" }, jobType: "AIRBNB_TURNOVER" };
    const jobRef = "J-1061";
    const whenLabel = "10:00";
    const subject = `Today's job: ${job.property.name} (${jobRef})`;
    const legacyBody = `You're rostered at ${job.property.name} today at ${whenLabel}. ${job.property.address}${timing ? ` — ${timing}` : ""}`;
    const legacySms = `sNeek Ops: Today at ${whenLabel} you're cleaning ${job.property.name} (${jobRef}). ${job.property.address}.${timing ? ` ${timing}.` : ""}`;
    const legacyHtml = `
      <div style="font-family:Arial,sans-serif;color:#111;">
        <h2 style="margin:0 0 6px;">Your job today</h2>
        <p style="margin:0 0 10px;color:#555;">${subject}</p>
        <table style="font-size:14px;border-collapse:collapse;">
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Property</td><td><strong>${job.property.name}</strong></td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Address</td><td>${job.property.address}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Start</td><td>${whenLabel}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Job</td><td>${job.jobType.replace(/_/g, " ")} · ${jobRef}</td></tr>
          ${timing ? `<tr><td style="padding:2px 10px 2px 0;color:#666;">Notes</td><td>${timing}</td></tr>` : ""}
        </table>
        <p style="margin:16px 0;">
          <a href="/cleaner/jobs" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">Open my jobs</a>
        </p>
      </div>`;
    const wording = defaultNotificationWording("job.cleaner_day_reminder");
    const t = { timingFlags: timing };
    const values = {
      propertyName: job.property.name, jobNumber: jobRef, when: whenLabel, propertyAddress: job.property.address, jobType: job.jobType.replace(/_/g, " "),
      timingDash: wording.line("timing-dash", "INBOX", t, Boolean(timing)),
      timingSuffix: wording.line("timing-line", "SMS", t, Boolean(timing)),
      timingRow: wording.line("timing-row", "EMAIL", t, Boolean(timing)),
    };
    const inbox = wording.render("cleaner", "INBOX", values);
    expect(inbox.title).toBe(subject);
    expect(inbox.body).toBe(legacyBody);
    const email = wording.render("cleaner", "EMAIL", values);
    expect(email.subject).toBe(subject);
    expect(email.html).toBe(legacyHtml);
    expect(wording.render("cleaner", "SMS", values).body).toBe(legacySms);
  });
});

describe("laundry.failed_pickup", () => {
  it("both notices are unchanged", () => {
    const wording = defaultNotificationWording("laundry.failed_pickup");
    const rescheduled = wording.render("rescheduled", "INBOX", { propertyName: "Manly Loft" });
    expect([rescheduled.title, rescheduled.body]).toEqual(["Laundry pickup rescheduled", `${"Manly Loft"}: ${"pickup rescheduled after failed attempt"}.`]);
    const approval = wording.render("approval", "INBOX", { propertyName: "Manly Loft", action: "SKIP".toLowerCase() });
    expect([approval.title, approval.body]).toEqual(["Laundry pickup approval requested", `Manly Loft: ${`${"SKIP".toLowerCase()} approval requested after failed pickup`}.`]);
  });
});

describe("office actions", () => {
  it.each(cases)("laundry nudge is unchanged (note: $note)", ({ note }) => {
    const wording = defaultNotificationWording("laundry.cleaner_nudge");
    const text = "The office needs to know whether the laundry is ready.";
    const legacy = `${text} (${"Manly Loft"}, ${"J-1"})${note ? ` Note: ${note}` : ""}`;
    const values = { laundryAsk: text, propertyName: "Manly Loft", jobNumber: "J-1", noteSuffix: wording.line("note-line", "INBOX", { note }, Boolean(note)) };
    expect(wording.render("photo", "INBOX", values)).toMatchObject({ title: "Laundry photo requested", body: legacy });
    expect(wording.render("ask", "INBOX", values)).toMatchObject({ title: "Laundry update needed", body: legacy });
    expect(wording.render("cleaner", "EMAIL", { ...values, messageText: legacy })).toMatchObject({ subject: `Laundry: ${"Manly Loft"}`, html: `<p>${escapeHtml(legacy)}</p>` });
  });

  it.each(cases)("laundry team request is unchanged (note: $note)", ({ note }) => {
    const wording = defaultNotificationWording("laundry.team_request");
    const place = "Manly Loft (Manly)";
    const legacy = `${"Please confirm the pickup."} (${place})${note ? ` Note: ${note}` : ""}`;
    const values = { laundryAsk: "Please confirm the pickup.", place, noteSuffix: wording.line("note-line", "INBOX", { note }, Boolean(note)) };
    const titles = { "confirm-pickup": "Please confirm the laundry pickup", "confirm-drop": "Please confirm the laundry drop-off", "return-eta": "When will the laundry be back?", photo: "Drop-off photo requested" };
    for (const [part, title] of Object.entries(titles)) expect(wording.render(part, "INBOX", values)).toMatchObject({ title, body: legacy });
    expect(wording.render("team", "EMAIL", { place, messageText: legacy })).toMatchObject({ subject: `Laundry: ${place}`, html: `<p>${escapeHtml(legacy)}</p>` });
  });

  it.each([{ eta: 30, note: "Traffic" }, { eta: null, note: null }, { eta: 15, note: null }])("client delay notice is unchanged ($eta, $note)", ({ eta, note }) => {
    const wording = defaultNotificationWording("client.delay_notice");
    const legacy = `Your clean at ${"Manly Loft"} is running late.${eta ? ` The new estimate is about ${eta} minutes.` : ""}${note ? ` ${note}` : ""}`;
    const inbox = wording.render("client", "INBOX", { propertyName: "Manly Loft", etaSentence: wording.line("eta-line", "INBOX", { etaMinutes: eta }, Boolean(eta)), noteSuffix: wording.line("note-line", "INBOX", { note }, Boolean(note)) });
    expect(inbox).toMatchObject({ title: "Your clean is running late", body: legacy });
    expect(wording.render("client", "EMAIL", { recipientName: "Jo & Co", propertyName: "Manly Loft", messageText: legacy }).html).toBe(`<p>Hi ${escapeHtml("Jo & Co")},</p><p>${escapeHtml(legacy)}</p>`);
  });

  it("clock paused notice is unchanged, quotes included", () => {
    const wording = defaultNotificationWording("jobs.clock_paused_by_office");
    const legacy = `The office paused your clock on ${"J-1 · Manly"} at ${"11:42"}. Reason given: "${"Left site"}". Your time up to then is kept. If you are still working, open the job and tap Resume clock.`;
    const inbox = wording.render("cleaner", "INBOX", { jobLabel: "J-1 · Manly", time: "11:42", reason: "Left site" });
    expect(inbox).toMatchObject({ title: "Your clock was paused by the office", body: legacy });
    expect(wording.render("cleaner", "EMAIL", { messageText: legacy }).html).toBe(`<p>${escapeHtml(legacy)}</p>`);
  });

  it.each([{ job: "J-1", note: "Any brand" }, { job: null, note: null }])("purchase ask is unchanged ($job, $note)", ({ job, note }) => {
    const ask = { itemName: "Toilet paper", quantity: 2, unit: "packs", propertyName: "Manly Loft", jobNumber: job, note };
    const legacyJob = ask.jobNumber ? ` before job ${ask.jobNumber}` : "";
    const legacyNote = ask.note ? ` Note from the office: "${ask.note}"` : "";
    const legacy = `The office asks if you can buy ${ask.quantity} ${ask.unit} of ${ask.itemName} for ${ask.propertyName}${legacyJob}. Open the job to accept or decline. If you accept it goes on your shopping run; keep the receipt — the office approves the reimbursement.${legacyNote}`;
    const wording = defaultNotificationWording("urgent_stock.purchase_ask");
    const inbox = wording.render("cleaner", "INBOX", { ...ask, beforeJob: wording.line("job-line", "INBOX", { jobNumber: job }, Boolean(job)), officeNote: wording.line("note-line", "INBOX", { note }, Boolean(note)) });
    expect(inbox).toMatchObject({ title: `Can you buy ${ask.itemName}?`, body: legacy });
    expect(wording.render("cleaner", "EMAIL", { itemName: ask.itemName, propertyName: ask.propertyName, messageText: legacy })).toMatchObject({ subject: `Can you buy ${ask.itemName} for ${ask.propertyName}?`, html: `<p>${escapeHtml(legacy)}</p>` });
  });

  it.each([{ notes: "Both sides please" }, { notes: null }])("document request is unchanged ($notes)", ({ notes }) => {
    const message = { title: "Police check", requestedByName: null as string | null, notes };
    const wording = defaultNotificationWording("workforce.document_request");
    const inbox = wording.render("staff", "INBOX", { requestedByName: message.requestedByName ?? "The office", documentTitle: message.title });
    expect(inbox).toMatchObject({ title: "Document requested", body: `${message.requestedByName ?? "The office"} requested ${message.title}. Upload it in your team hub.` });
    const email = wording.render("staff", "EMAIL", { recipientName: "Ana", documentTitle: message.title, notesParagraph: wording.line("notes-paragraph", "EMAIL", { note: notes }, Boolean(notes)) });
    expect(email.subject).toBe(`Document requested - ${message.title}`);
    expect(email.html).toBe(`<p>Hi ${escapeHtml("Ana")},</p><p>Please upload the following document in your team hub: <strong>${escapeHtml(message.title)}</strong>.</p>${message.notes ? `<p>${escapeHtml(message.notes)}</p>` : ""}`);
    expect(defaultNotificationWording("workforce.document_request_sms").render("staff", "SMS", { documentTitle: message.title }).body).toBe(`Document requested: ${message.title}. Upload it in your sNeek team hub.`);
  });
});
