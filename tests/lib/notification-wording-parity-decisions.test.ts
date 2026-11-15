// @vitest-environment node
/** Parity for job.cleaner_requests_decided (legacy expressions copied verbatim from the producers). */
import { vi, describe, expect, it } from "vitest";
// The body composition is what these tests pin; the block-design spec the send path uses is tested in email-design-wording.test.ts.
vi.mock("@/lib/email-design/wording-bridge", () => ({ attachWordingDesign: (html: string) => html }));
import { defaultNotificationWording } from "@/lib/notifications/wording/render";

const P = "Manly Loft";
const J = "J-1061";

describe("job.cleaner_requests_decided", () => {
  const w = defaultNotificationWording("job.cleaner_requests_decided");

  it("continuation, timing and clock decisions are unchanged", () => {
    expect(w.render("continuation-approved", "INBOX", { continuationJobId: "j2" })).toMatchObject({ title: "Continuation approved", body: `A continuation has been scheduled for your job (${"j2"})` });
    expect(w.render("continuation-declined", "INBOX", { decisionNote: w.line("declined-default", "INBOX", {}) })).toMatchObject({ title: "Continuation request declined", body: "Admin declined this request." });
    expect(w.render("timing-reviewed", "INBOX", { cleanerName: "Ana", decision: "approved", jobId: "j1" }).body).toBe(`${"Ana"} ${"approved"} the timing update for job ${"j1"}.`);
    expect(w.render("clock-approved", "INBOX", { jobNumber: J, propertyName: P }).body).toBe(`${J}: Admin approved your requested final time for ${P}.`);
    expect(w.render("clock-rejected", "INBOX", { jobNumber: J, propertyName: P }).body).toBe(`${J}: Admin rejected your requested clock change for ${P}.`);
    const clock = w.render("clock-decision", "EMAIL", { companyName: "sNeek", status: "APPROVED", recipientName: "Ana", propertyName: P, jobNumber: J, decision: "approved", approvedTimeParagraph: w.line("approved-time", "EMAIL", { minutes: 185 }), adminNoteParagraph: "" });
    expect(clock.subject).toBe(`${"sNeek"} - Clock Adjustment ${"APPROVED"}`);
    expect(clock.html).toBe(`
        <p>Hello ${"Ana"},</p>
        <p>Your clock adjustment request for <strong>${P}</strong> (${J}) has been <strong>${"approved"}</strong>.</p>
        ${`<p><strong>Approved total time:</strong> ${185} minutes</p>`}
        ${""}
      `);
  });

  it("pay notices are unchanged", () => {
    const money = "$40.00";
    expect(w.render("pay-addition-approved", "INBOX", { amount: money, reason: "oven" })).toMatchObject({ title: `Extra payment approved — ${money}`, body: `An extra payment of ${money} has been approved for ${"oven"}. It will be included in your next invoice/payroll run.` });
    expect(w.render("pay-deduction-approved", "INBOX", { amount: money, reason: "oven" })).toMatchObject({ title: `Pay deduction approved — ${money}`, body: `A ${money} deduction has been approved against your pay for ${"oven"}. It will be applied to your next invoice/payroll run.` });
    expect(w.render("pay-declined", "INBOX", { amount: money, reason: "oven", direction: "addition" })).toMatchObject({ title: `Pay ${"addition"} declined`, body: `The proposed ${"addition"} of ${money} for ${"oven"} was not approved. Your pay is unchanged.` });
    expect(w.render("pay-reopened", "INBOX", { amount: money, reason: "oven", direction: "deduction" }).body).toBe(`The ${"deduction"} of ${money} for ${"oven"} has been set back to pending review, so it no longer affects your pay until it is decided again.`);
    const shell = (title: string, bodyHtml: string, url: string) => `<div style="font-family:Arial,sans-serif;color:#111;">
    <h2 style="margin:0 0 8px;">${title}</h2>
    <div style="color:#555;margin:0 0 12px;">${bodyHtml}</div>
    <p style="margin:16px 0;"><a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">${"View my pay"}</a></p>
  </div>`;
    const inbox = w.render("pay-amount-changed", "INBOX", { amount: money, previousAmount: "$30.00", reason: "oven", direction: "addition" });
    expect(inbox.body).toBe(`The approved ${"addition"} for ${"oven"} changed from ${"$30.00"} to ${money}.`);
    const email = w.render("pay-amount-changed", "EMAIL", { companyName: "sNeek", title: inbox.title, messageText: inbox.body, actionUrl: "https://a/p", adminNoteParagraph: w.line("admin-note", "EMAIL", { note: "Checked" }) });
    expect(email).toMatchObject({ subject: `${"sNeek"}: ${inbox.title}`, html: shell(inbox.title, `<p>${inbox.body}</p>${`<p><strong>Admin note:</strong> ${"Checked"}</p>`}`, "https://a/p") });
    expect(w.render("minutes-removed", "INBOX", { minutes: 20, propertyName: P, reason: "Rework" })).toMatchObject({ title: `${20} min removed from your logged time`, body: `${20} minutes were removed from your recorded time on ${P} following an approved QA rework. Reason: ${"Rework"}` });
    expect(w.render("minutes-added", "INBOX", { minutes: 20, propertyName: P }).body).toBe(`${20} minutes were added to your recorded time on ${P} for the QA rework you carried out.`);
  });

  it("extra-pay request decisions are unchanged", () => {
    const note = " Thanks";
    expect(w.render("extra-pay-approved", "INBOX", { status: "approved", propertyName: P, newAmount: "$40.00", decisionSuffix: note })).toMatchObject({ title: `Extra payment request ${"approved"} - ${P}`, body: `Approved $${"40.00"} for ${P}.${note}` });
    expect(w.render("extra-pay-rejected", "INBOX", { status: "rejected", propertyName: P, decisionSuffix: "" }).body).toBe(`Rejected extra payment request for ${P}.${""}`);
    expect(w.render("extra-pay-reopened", "INBOX", { propertyName: P, decisionSuffix: note })).toMatchObject({ title: `Extra payment request reopened - ${P}`, body: `Your extra payment request for ${P} was set back to pending for review.${note}` });
    expect(w.render("extra-pay-updated", "INBOX", { propertyName: P, oldAmount: "$30.00", newAmount: "$40.00", decisionSuffix: "" }).body).toBe(`Your approved payment for ${P} was updated from $${"30.00"} to $${"40.00"}.${""}`);
    const intro = w.line("intro-decided", "EMAIL", { propertyName: P, decision: "approved", approvedAmountParagraph: w.line("approved-amount", "EMAIL", { newAmount: "$40.00" }) });
    expect(intro).toBe(`<p>Your extra payment request for <strong>${P}</strong> has been <strong>${"approved"}</strong>.</p>${`<p><strong>Approved amount:</strong> $${"40.00"}</p>`}`);
    expect(w.render("extra-pay-decision", "EMAIL", { companyName: "sNeek", emailTitle: w.line("title-decided", "EMAIL", { status: "APPROVED" }), recipientName: "Ana", intro, decisionParagraph: "" })).toMatchObject({
      subject: `${"sNeek"} - ${`Extra Payment Request ${"APPROVED"}`}`,
      html: `
          <p>Hello ${"Ana"},</p>
          ${intro}
          ${""}
        `,
    });
    expect(w.render("extra-pay-edited", "INBOX", { propertyName: P, requestedAmount: "$45.00" }).body).toBe(`An admin updated the details of your extra payment request for ${P}. New requested amount: $${(45).toFixed(2)}.`);
  });
});
