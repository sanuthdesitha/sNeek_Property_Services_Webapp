// @vitest-environment node
/**
 * Parity, third set (2026-11-12): the sentences that were still in code on the
 * "editable parts" types. Each legacy expression is the producer's original
 * template literal, copied verbatim and run on the same values.
 */
import { describe, expect, it } from "vitest";
import { defaultNotificationWording } from "@/lib/notifications/wording/render";
import { escapeHtml } from "@/lib/utils/escape-html";

const P = "Manly Loft";
const J = "J-1061";
const companyName = "sNeek";

describe("job.offer and job.skipped_or_cancelled", () => {
  const w = defaultNotificationWording("job.offer");
  it("titles, bulk SMS and digest sentences are unchanged", () => {
    expect(w.line("title-offer", "INBOX", { companyName, jobNumber: J })).toBe(`${companyName}: New job offer (${J})`);
    expect(w.line("title-updated", "INBOX", { companyName, jobNumber: J })).toBe(`${companyName}: Job assignment updated (${J})`);
    expect(w.line("title-removed", "INBOX", { companyName, jobNumber: J })).toBe(`${companyName}: Job removed from your schedule (${J})`);
    expect(w.line("title-transfer", "INBOX", { companyName, jobNumber: J })).toBe(`${companyName}: New transferred job offer (${J})`);
    expect(w.line("title-rule-alert", "INBOX", { companyName })).toBe(`${companyName}: Rule alert`);
    expect(w.line("awaiting-confirmation", "INBOX", {})).toBe("Awaiting confirmation");
    expect(w.line("transferred-by", "INBOX", { actorName: "Ana" })).toBe(`Transferred by ${"Ana"}. Awaiting confirmation.`);
    const line = { jobReference: J, propertyName: P, when: "2026-11-14 10:00" };
    expect(w.render("bulk", "SMS", { companyName, jobNumber: line.jobReference, propertyName: line.propertyName, when: line.when }).body).toBe(`${companyName}: New job offer ${line.jobReference} — ${line.propertyName} on ${line.when}. Open the app to confirm.`);
    expect(w.render("bulk-many", "SMS", { companyName, jobCount: 3, refs: "J-1, J-2, J-3" }).body).toBe(`${companyName}: ${3} new jobs assigned (${"J-1, J-2, J-3"}). Open the app to review and confirm.`);
    for (const count of [1, 2]) {
      const jobWord = count === 1 ? "job" : "jobs";
      expect(w.line("bulk-subject", "INBOX", { jobCount: count, jobWord, companyName })).toBe(`${count} new ${jobWord} assigned — ${companyName}`);
      expect(w.line("bulk-heading", "EMAIL", { jobCount: count, jobWord })).toBe(`You've been assigned ${count} ${jobWord}`);
      expect(w.line("bulk-intro", "EMAIL", { userName: "Ana", jobWord, hasWord: count === 1 ? "has" : "have", itWord: count === 1 ? "it" : "each one" }))
        .toBe(`Hello ${escapeHtml("Ana")}, the following ${jobWord} ${count === 1 ? "has" : "have"} been added to your schedule. Open the Cleaner Portal to confirm ${count === 1 ? "it" : "each one"} and view full access details.`);
      expect(w.line("bulk-outro", "EMAIL", { offerWord: count === 1 ? "this offer" : "each offer" })).toBe(`Please review and confirm ${count === 1 ? "this offer" : "each offer"} at your earliest convenience.`);
    }
  });

  it("accept / decline / transfer notices are unchanged", () => {
    const v = { companyName, actorName: "Ana", jobNumber: J, propertyName: P, transferredTo: "Bo" };
    expect(w.render("accepted", "INBOX", v)).toMatchObject({ title: `${companyName}: Job accepted (${J})`, body: `${"Ana"} accepted ${J} for ${P}.` });
    expect(w.render("declined", "SMS", v).body).toBe(`${"Ana"} declined ${J} at ${P}.`);
    expect(w.render("transferred", "INBOX", v).body).toBe(`${"Ana"} transferred ${J} for ${P} to ${"Bo"}.`);
    const adminSubject = `${companyName}: Job transferred (${J})`;
    const note = "Swap";
    expect(w.render("response", "EMAIL", { ...v, title: adminSubject, when: "2026-11-14", outcome: w.line("outcome-transferred", "EMAIL", v), nextStatus: "Offered", cleanerNoteParagraph: w.line("cleaner-note", "EMAIL", { note }) }).html).toBe(`
          <h2 style="margin:0 0 12px;">${adminSubject}</h2>
          <p><strong>${J}</strong> for <strong>${P}</strong> (${"2026-11-14"}) was updated.</p>
          <p><strong>Cleaner:</strong> ${"Ana"}</p>
          <p><strong>Outcome:</strong> ${`Transferred to ${"Bo"}`}</p>
          <p><strong>Next job status:</strong> ${"Offered"}</p>
          ${`<p><strong>Cleaner note:</strong> ${note}</p>`}
        `);
  });

  it("skip and iCal shift notices are unchanged", () => {
    const s = defaultNotificationWording("job.skipped_or_cancelled");
    expect(s.render("skip-approved", "INBOX", { propertyName: P })).toMatchObject({ title: "Clean skipped", body: `Your request to skip the clean at ${P} was approved — this turnover will not be cleaned.` });
    expect(s.render("skip-declined", "INBOX", { propertyName: P }).body).toBe(`Your request to skip the clean at ${P} was declined — the clean will go ahead as scheduled.`);
    expect(s.render("booking-moved", "INBOX", { propertyName: P, oldDate: "2026-11-14", newDate: "2026-11-16" })).toMatchObject({ title: "Shift cancelled — booking moved", body: `${P}: your shift on ${"2026-11-14"} was removed because the booking moved to ${"2026-11-16"}. The job is now unassigned.` });
    expect(s.render("booking-removed", "INBOX", { propertyName: P, oldDate: "2026-11-14" }).body).toBe(`${P}: your shift on ${"2026-11-14"} was cancelled because the booking is no longer on the calendar. It has been removed from your schedule.`);
  });
});

describe("job.cleaner_invoice, office.cases, office.sla_and_summaries, office.new_profile", () => {
  it("change-request email is unchanged", () => {
    const w = defaultNotificationWording("job.cleaner_invoice");
    for (const invoiceNumber of ["INV-42", null]) {
      const note = "Remove 12 Nov\nAdd oven";
      const email = w.render("change-request", "EMAIL", { recipientName: "Ana", periodStart: "1 Nov 2026", periodEnd: "14 Nov 2026", invoiceSuffix: w.line("invoice-suffix", "INBOX", { invoiceNumber }, Boolean(invoiceNumber)), invoiceNumberPart: w.line("invoice-number", "EMAIL", { invoiceNumber }, Boolean(invoiceNumber)), fixHtml: note.replace(/\n/g, "<br/>"), invoicesUrl: "https://a/i", companyName });
      expect(email.subject).toBe(`Your invoice needs a change${invoiceNumber ? ` — ${invoiceNumber}` : ""}`);
      expect(email.html).toBe([
        `<p>Hi ${"Ana"},</p>`, `<p>Your invoice for ${"1 Nov 2026"} – ${"14 Nov 2026"}`, invoiceNumber ? ` (<strong>${invoiceNumber}</strong>)` : "", ` has been sent back for a change.</p>`,
        `<p><strong>What needs fixing:</strong><br/>${note.replace(/\n/g, "<br/>")}</p>`, `<p>Everything on it is available to invoice again, so you can correct it and resend.</p>`,
        `<p><a href="${"https://a/i"}">Open your invoices</a></p>`, `<p>— ${companyName}</p>`,
      ].join(""));
    }
  });

  it("case follow-up, SLA, briefing and profile lines are unchanged", () => {
    const c = defaultNotificationWording("office.cases");
    expect(c.render("follow-up-one", "INBOX", { caseLine: "Lock - P - Job 1 - stale for 3 days" })).toMatchObject({ title: "1 case needs follow-up", body: "Lock - P - Job 1 - stale for 3 days" });
    expect(c.render("follow-up-many", "INBOX", { count: 4 })).toMatchObject({ title: `${4} cases need follow-up`, body: `${4} cases have been open for more than 48 hours.` });
    expect(c.render("follow-up", "EMAIL", { title: "1 case needs follow-up", caseItems: "<li>x</li>", casesUrl: "https://a/c" })).toMatchObject({ subject: `sNeek follow-up: ${"1 case needs follow-up"}`, html: `
    <h2 style="margin:0 0 12px;">Cases needing follow-up</h2>
    <p>The following cases have been open without an update for more than 48 hours.</p>
    <ul style="margin:16px 0;padding-left:20px;line-height:1.7;">
      ${"<li>x</li>"}
    </ul>
    <p><a href="${"https://a/c"}" style="color:#0f766e;font-weight:600;">Open cases board</a></p>
  `.trim() });
    const s = defaultNotificationWording("office.sla_and_summaries");
    expect(s.render("sla-breach", "INBOX", { propertyName: P, suburb: "Manly", minutes: 40 })).toMatchObject({ title: "SLA breach", body: `${P} (${"Manly"}) overdue by ${40} mins.` });
    expect(s.render("commercial-scan", "INBOX", { count: 3, issuesSentence: s.line("issues-sentence", "INBOX", { issues: 2 }) }).body).toBe(`Detected ${3} breach(es).${` Created ${2} issue ticket(s).`}`);
    const b = { date: "13 Nov 2026", dateLabel: "Friday, 13 Nov 2026", jobsToday: 5, unassignedToday: 1, laundryPickups: 2, openCases: 3, newLeads: 4, expiringDocs: 0, statusMix: s.line("no-jobs", "EMAIL", {}) };
    expect(s.render("daily-briefing", "EMAIL", b)).toMatchObject({ subject: `sNeek ops briefing - ${"13 Nov 2026"}`, html: `
    <h2 style="margin:0 0 12px;">Morning ops briefing</h2>
    <p>${"Friday, 13 Nov 2026"}</p>
    <ul style="margin:16px 0;padding-left:20px;line-height:1.7;">
      <li><strong>${5}</strong> jobs scheduled today</li>
      <li><strong>${1}</strong> unassigned jobs today</li>
      <li><strong>${2}</strong> laundry pickups today</li>
      <li><strong>${3}</strong> cases open for more than 48 hours</li>
      <li><strong>${4}</strong> new leads in the last 24 hours</li>
      <li><strong>${0}</strong> staff documents expired or expiring within 14 days</li>
    </ul>
    <p>Status mix: ${"No jobs"}</p>
  ` });
    expect(s.line("tomorrow-none-html", "EMAIL", {})).toBe("<p>No jobs are scheduled for tomorrow.</p><p>Please still check your schedule in case anything changes.</p>");
    expect(s.line("laundry-none-text", "INBOX", {})).toBe("No laundry pickups or drop-offs scheduled for tomorrow. Please still check your schedule in case anything changes.");
    const n = defaultNotificationWording("office.new_profile");
    expect([n.line("via-registration", "INBOX", {}), n.line("via-onboarding", "INBOX", {})]).toEqual(["self registration", "invited account onboarding"]);
  });
});

describe("laundry.updates", () => {
  const w = defaultNotificationWording("laundry.updates");
  it("laundry notices are unchanged", () => {
    expect(w.render("not-ready", "INBOX", { jobNumber: J, propertyName: P })).toMatchObject({ title: `Laundry not ready - ${J}`, body: `${J}: Cleaner submitted job for ${P} with laundry_ready=NO. Laundry partner was not notified.` });
    expect(w.render("contradiction", "INBOX", { jobNumber: J, propertyName: P, outcome: "NOT_READY".replace(/_/g, " ").toLowerCase() }).body).toBe(`${J}: Final submission for ${P} said laundry ${"not ready"}, but an earlier update already confirmed the pickup and laundry partners were notified. The confirmed pickup was KEPT - review and adjust the laundry task manually if the pickup really should be cancelled.`);
    for (const n of [1, 2]) {
      expect(w.render("catch-up", "INBOX", { count: n, taskWord: n === 1 ? "task" : "tasks", needWord: n === 1 ? "needs" : "need", tasks: "Manly pickup" }).body).toBe(`${n} laundry task${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} action: ${"Manly pickup"}. Open Today to catch up before end of day.`);
      const v = { propertyName: P, count: n, bookingWord: n === 1 ? "booking" : "bookings" };
      expect(w.render("schedule-updated", "INBOX", v)).toMatchObject({ title: `Laundry schedule updated - ${P}`, body: `${n} laundry booking${n === 1 ? "" : "s"} updated after reservation sync. Review the laundry portal.` });
      expect(w.render("schedule-updated", "SMS", v).body).toBe(`${P}: ${n} laundry booking${n === 1 ? "" : "s"} updated after sync. Check the laundry portal.`);
    }
    expect(w.render("schedule-updated", "EMAIL", { title: "T", propertyName: P, bookingItems: "<li>b</li>", portalUrl: "https://a/l" }).html).toBe(`
          <h2 style="margin:0 0 12px;">Laundry schedule updated</h2>
          <p style="margin:0 0 12px;">Admin approved reservation-driven schedule changes for <strong>${P}</strong>.</p>
          <ul style="margin:0 0 16px 18px; padding:0;">${"<li>b</li>"}</ul>
          <p style="margin:0 0 16px;">Open the laundry portal to review the latest pickup and drop-off dates.</p>
          <p style="margin:0;"><a href="${"https://a/l"}">Open laundry portal</a></p>
        `);
    const mode: string = "PERMANENT";
    expect(w.render(mode === "PERMANENT" ? "task-deleted" : "task-removed", "INBOX", { propertyName: P, actor: "ops@x", pickupDate: "14/11/2026", note: "Dup" }).body)
      .toBe(`${P}: ${"ops@x"} ${mode === "PERMANENT" ? "permanently deleted" : "removed"} the laundry set (pickup ${"14/11/2026"}). ${"Dup"}`);
    expect(w.render("request-rejected", "INBOX", { propertyName: P, notesSuffix: w.line("notes-suffix", "INBOX", { notes: "No" }) }).body).toBe(`${P}: failed pickup request was rejected.${` ${"No"}`}`);
    expect(w.render("pickup-skipped", "INBOX", { propertyName: P, reasonSuffix: w.line("reason-suffix", "INBOX", { reason: "GUEST STAYING" }) })).toMatchObject({ title: "Pickup skipped", body: `${P}: pickup skipped.${` Reason: ${"GUEST STAYING"}`}` });
  });
});

describe("stock, shopping and lost-found", () => {
  it("stock and shopping notices are unchanged", () => {
    const a = defaultNotificationWording("stock.alerts");
    expect(a.render("daily-low", "EMAIL", { count: 3, lines: "- a\n- b", inventoryLink: a.line("view-shopping-list", "EMAIL", { inventoryUrl: "https://a/inv" }) })).toMatchObject({ subject: `sNeek Ops: ${3} items low on stock`, html: `<p>${3} items are below reorder threshold:</p><pre>${"- a\n- b"}</pre>${`<p><a href="${"https://a/inv"}">View shopping list</a></p>`}` });
    expect(a.render("daily-low-log", "INBOX", { count: 3 })).toMatchObject({ title: `Low stock alert (${3})`, body: `${3} items are below reorder threshold.` });
    const scan = a.render("scan-task", "EMAIL", { assigneeName: "Ana", requestedByName: "Hannah", place: P, dueSuffix: a.line("due-suffix", "EMAIL", { due: "14 Nov" }), notesParagraph: "", scannerUrl: "https://a/s", companyName });
    expect(scan.subject).toBe(`Stock count needed — ${P}`);
    expect(scan.html).toBe([`<p>Hi ${"Ana"},</p>`, `<p>${"Hannah"} has asked you to do a stock count at <strong>${P}</strong>${`, by <strong>${"14 Nov"}</strong>`}.</p>`, "", `<p><a href="${"https://a/s"}">Open the scanner for this property</a></p>`, `<p>Scan every item in the cupboard — repeats are counted, so scan each bottle. You will get a summary to check and correct before anything is saved.</p>`, `<p>— ${companyName}</p>`].join(""));
    const s = defaultNotificationWording("stock.shopping_and_orders");
    const restock = s.render("restock", "INBOX", { propertyName: P, count: 2, itemWord: "items", countedBy: "Ana", changedCount: 1, changedWord: "item", emptySuffix: s.line("empty-suffix", "INBOX", { zeroedCount: 1 }) });
    expect(restock).toMatchObject({ title: `${P}: ${2} item${"s"} to restock`, body: `${"Ana"} counted the stock at ${P}. ` + `${1} item${""} changed` + `, ${1} now empty` + "." });
    expect(s.render("restock", "SMS", { title: restock.title, summary: restock.body }).body).toBe(`${restock.title}. ${restock.body}`);
    expect(s.line("client-intro", "INBOX", {})).toBe("Purchases have been logged for your properties. View item quantities, recorded costs and available receipts in your client portal. Purchase costs are not an invoice or payment request.");
    expect(s.render("purchase-order", "EMAIL", { runName: "Run 1", supplierSuffix: s.line("supplier-suffix", "INBOX", { supplier: "Bunnings" }), supplierParagraph: s.line("supplier-paragraph", "EMAIL", { supplier: "Bunnings" }) })).toMatchObject({ subject: `Purchase Order - ${"Run 1"}${` (${"Bunnings"})`}`, html: `
        <p>Please find the attached purchase order.</p>
        <p><strong>Run:</strong> ${"Run 1"}</p>
        ${`<p><strong>Supplier:</strong> ${"Bunnings"}</p>`}
      ` });
    expect(s.render("reimbursement", "EMAIL", { clientName: "Sam", runName: "Run 1", amount: "$40.00", receiptCount: 2 }).subject).toBe(`Shopping reimbursement - ${"Sam"} - ${"Run 1"}`);
    expect(s.render("shopping-list", "EMAIL", { companyName, scope: "All properties", recipientName: "there" }).subject).toBe(`${companyName} - Inventory Shopping List (${"All properties"})`);
    expect(s.render("supplier-order", "EMAIL", { companyName, supplier: "Bunnings", lookbackDays: 30, estimatedTotal: "$90.00", orderRows: "" }).subject).toBe(`${companyName} - Suggested Order (${"Bunnings"})`);
    const l = defaultNotificationWording("office.lost_found_report");
    expect(l.render("log", "INBOX", { itemName: "Watch", locationSuffix: l.line("location-suffix", "INBOX", { location: "Bedroom" }), propertyName: P })).toMatchObject({ title: "Lost & Found item reported", body: `Item: ${"Watch"}${` at ${"Bedroom"}`} (${P})` });
  });
});

describe("client.documents, client.approvals, account.invitations, leads.alerts", () => {
  it("document and approval emails are unchanged", () => {
    const d = defaultNotificationWording("client.documents");
    expect(d.line("quote-subject", "INBOX", { companyName })).toBe(`${companyName}: Your quote`);
    expect(d.render("checklist", "EMAIL", { companyName, service: "deep clean" })).toMatchObject({ subject: `${companyName}: Your service checklist`, html: `<p>Please find the latest service checklist for your ${"deep clean"} attached.</p>` });
    const publicUrl = "https://a/q/abc";
    expect(d.render("addons", "EMAIL", { companyName, onlineSentence: d.line("addons-online", "EMAIL", { quoteUrl: publicUrl }) }).html).toBe(`<p>Here's our full list of optional add-ons you can add to your clean.${publicUrl ? ` You can also request them online: <a href="${publicUrl}">view your quote</a>.` : ""}</p>`);
    expect(d.render("online-link", "EMAIL", { companyName, quoteUrl: publicUrl })).toMatchObject({ subject: `${companyName}: View your quote & request add-ons online`, html: `<p>You can view your quote and request any optional add-ons online here:</p><p><a href="${publicUrl}">${publicUrl}</a></p>` });
    const booking = d.render("booking-updated", "EMAIL", { clientName: "Sam", atProperty: d.line("at-property", "EMAIL", { propertyName: P }), dateLabel: "Fri 14 Nov", jobNumber: J, addedBlock: d.line("added-block", "EMAIL", { items: "<li>Oven</li>" }), removedBlock: "", noteParagraph: "", total: "$200.00", companyName });
    expect(booking.subject).toBe(`Your booking has been updated — ${companyName}`);
    expect(booking.html).toBe(`
      <h2 class="h2" style="margin:0 0 14px;font-size:24px;font-weight:600;">Your booking has been updated</h2>
      <p style="margin:0 0 14px;">Hi ${"Sam"},</p>
      <p style="margin:0 0 14px;">
        We've updated your booking${` at <strong>${P}</strong>`}
        scheduled for <strong>${"Fri 14 Nov"}</strong> (job ${J}).
      </p>
      ${`<p style="margin:0 0 6px;font-weight:600;">Added to your service:</p><ul style="margin:0 0 14px;padding-left:20px;">${"<li>Oven</li>"}</ul>`}
      ${""}
      ${""}
      <p style="margin:0 0 6px;font-size:16px;">
        Updated total for this booking: <strong>${"$200.00"}</strong>
      </p>
      <p style="margin:14px 0 0;color:#6b6b66;font-size:13px;">
        If anything here doesn't look right, just reply or contact us and we'll sort it out.
      </p>
    `);
    const a = defaultNotificationWording("client.approvals");
    expect(a.render("approval-required", "INBOX", { placeName: "Sam Host", approvalTitle: "Oven" })).toMatchObject({ title: "Approval required", body: `${"Sam Host"}: ${"Oven"}` });
    const approvalUrl = "https://a/approvals";
    expect(a.render("pay-approval", "EMAIL", { companyName, propertyName: P, approvalTitle: "Oven", amount: "AUD 40.00", descriptionParagraph: a.line("description-paragraph", "EMAIL", { description: "Extra" }), approvalUrl })).toMatchObject({ subject: `${companyName} - Approval required`, html: `
          <p>An approval is required for <strong>${P}</strong>.</p>
          <p><strong>${"Oven"}</strong></p>
          <p>Amount: ${"AUD"} ${(40).toFixed(2)}</p>
          ${`<p>${"Extra"}</p>`}
          <p>Review here: <a href="${approvalUrl}">${approvalUrl}</a></p>
        ` });
  });

  it("invitation and website lead emails are unchanged", () => {
    const i = defaultNotificationWording("account.invitations");
    expect([i.line("button-complete-setup", "INBOX", {}), i.line("button-set-password", "INBOX", {})]).toEqual(["Sign in and complete setup", "Sign in and set your password"]);
    const manageUrl = "https://a/team";
    const plural = "s";
    expect(i.render("assistants-added", "EMAIL", { companyName, assistantWord: "assistants", teamName: "Ops", assistantItems: "<li>Kim</li>", grantParagraph: i.line("grant-new-team", "EMAIL", {}), manageUrl })).toMatchObject({ subject: `${companyName} - assistant access added to your account`, html: `
            <p>We have set up portal access for the following assistant${plural}, on the team <strong>${escapeHtml("Ops")}</strong>:</p>
            <ul>${"<li>Kim</li>"}</ul>
            ${"<p>You can change what they are allowed to do at any time.</p>"}
            <p>Manage their access here: <a href="${manageUrl}">${manageUrl}</a></p>
            <p>Assistants can never approve quotes or extras, approve costs, or pay invoices. Those stay with you.</p>
          ` });
    const l = defaultNotificationWording("leads.alerts");
    const body = { name: "Sam", email: "sam@example.invalid", phone: "", suburb: "Manly", address: "", notes: "", estimateMin: 120, estimateMax: undefined as number | undefined };
    const service = "Deep clean";
    const notProvided = l.line("not-provided", "INBOX", {});
    const html = l.render("website-quote", "EMAIL", { name: body.name, email: body.email, phone: body.phone || notProvided, suburb: body.suburb || notProvided, address: body.address || notProvided, service, estimate: `$${body.estimateMin.toFixed(2)}${l.line("estimate-to", "INBOX", { amount: "" }, false)}`, notesHtml: escapeHtml(body.notes || l.line("no-notes", "INBOX", {})).replace(/\n/g, "<br />"), leadId: "lead1" });
    expect(html.subject).toBe(`New quote request: ${body.name} (${service})`);
    expect(html.html).toBe(`
          <h2>New quote request received</h2>
          <p><strong>Name:</strong> ${escapeHtml(body.name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(body.email)}</p>
          <p><strong>Phone:</strong> ${escapeHtml(body.phone || "Not provided")}</p>
          <p><strong>Suburb:</strong> ${escapeHtml(body.suburb || "Not provided")}</p>
          <p><strong>Address:</strong> ${escapeHtml(body.address || "Not provided")}</p>
          <p><strong>Requested service:</strong> ${escapeHtml(service)}</p>
          <p><strong>Estimate range:</strong> ${typeof body.estimateMin === "number" ? `$${body.estimateMin.toFixed(2)}` : "Pending manual review"}${typeof body.estimateMax === "number" ? ` to $${(body.estimateMax as number).toFixed(2)}` : ""}</p>
          <p><strong>Notes:</strong></p>
          <p>${escapeHtml(body.notes || "No extra notes provided.").replace(/\n/g, "<br />")}</p>
          <p><strong>Lead ID:</strong> ${escapeHtml("lead1")}</p>
        `);
  });
});
