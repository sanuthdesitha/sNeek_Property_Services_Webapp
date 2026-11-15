// @vitest-environment node
/**
 * Parity, second set (2026-11-12, the types that were "in code"): with no
 * override every part renders exactly what its producer composed before the
 * wording layer. Each legacy expression below is the producer's original
 * template literal, copied verbatim and run on the same values. Values without
 * HTML-special characters are used for email bodies (the wording layer now
 * escapes every value; see notification-wording.test.ts for escaping).
 */
import { vi, describe, expect, it } from "vitest";
// The body composition is what these tests pin; the block-design spec the send path uses is tested in email-design-wording.test.ts.
vi.mock("@/lib/email-design/wording-bridge", () => ({ attachWordingDesign: (html: string) => html }));
import { defaultNotificationWording } from "@/lib/notifications/wording/render";
import { escapeHtml } from "@/lib/utils/escape-html";
import { buildClientJobMessage } from "@/lib/notifications/client-job-notifications";

const P = "Manly Loft";
const J = "J-1061";

describe("client.job_updates", () => {
  const w = defaultNotificationWording("client.job_updates");
  const company = "sNeek";
  const cleaner = "Ana";
  const trip = "https://app.example.invalid/client/jobs/1";
  const late = "Note: Your cleaner is running approximately 15 minutes behind the scheduled start time of 10:00.";

  it.each([[null, null, null], [12, trip, late], [1, trip, null], [null, trip, late]] as const)("every event and transport is unchanged (eta %s, link %s, note %s)", (etaMinutes, liveTripUrl, scheduleNote) => {
    const eta = etaMinutes == null ? null : etaMinutes <= 1 ? "less than a minute away" : null;
    const liveTripLine = liveTripUrl ? ` Track live: ${liveTripUrl}` : "";
    const scheduleLineSms = scheduleNote ? ` ${scheduleNote}` : "";
    const link = (label: string) => (liveTripUrl ? `<p><a href="${liveTripUrl}">${label}</a></p>` : "");
    const scheduleHtml = scheduleNote ? `<p style="color:#b45309">${scheduleNote}</p>` : "";
    const enRoute = buildClientJobMessage(w, "EN_ROUTE", company, P, cleaner, etaMinutes, liveTripUrl, scheduleNote);
    const etaText = enRoute.webBody.includes("ETA") ? enRoute.webBody.split("— ETA ")[1]?.replace(/\.$/, "") ?? null : eta;
    expect(enRoute.subject).toBe(`${company}: Your cleaner is on the way`);
    expect(enRoute.webBody).toBe(etaText ? `${cleaner} is on the way to ${P} — ETA ${etaText}.` : `${cleaner} is on the way to ${P}.`);
    expect(enRoute.smsBody).toBe((etaText ? `Hi! Your ${company} cleaner is on the way to ${P}. ETA: ${etaText}.${liveTripLine}` : `Hi! Your ${company} cleaner is on the way to ${P}.${liveTripLine}`) + scheduleLineSms);
    expect(enRoute.emailHtml).toBe(`<p>Hi! Your ${company} cleaner <strong>${cleaner}</strong> is on the way to <strong>${P}</strong>.</p>${etaText ? `<p><strong>ETA:</strong> ${etaText}</p>` : ""}${scheduleHtml}${link("Track live")}`);
    const update = buildClientJobMessage(w, "EN_ROUTE_UPDATE", company, P, cleaner, etaMinutes, liveTripUrl, scheduleNote);
    expect(update.subject).toBe(`${company}: Updated ETA for your clean`);
    expect(update.webBody).toBe(etaText ? `Updated ETA: ${cleaner} is now ${etaText} from ${P}.` : `Your cleaner is on the way to ${P}.`);
    expect(update.smsBody).toBe((etaText ? `ETA update: Your ${company} cleaner is now ${etaText} from ${P}.${liveTripLine}` : `Your ${company} cleaner is on the way to ${P}.${liveTripLine}`) + scheduleLineSms);
    expect(update.emailHtml).toBe(`${etaText ? `<p><strong>${cleaner}</strong> is now ${etaText} from <strong>${P}</strong>.</p>` : `<p>Your ${company} cleaner is on the way to <strong>${P}</strong>.</p>`}${scheduleHtml}${link("Track live")}`);
    const arrived = buildClientJobMessage(w, "EN_ROUTE_ARRIVED", company, P, cleaner, etaMinutes, liveTripUrl, scheduleNote);
    expect([arrived.subject, arrived.webBody, arrived.smsBody, arrived.emailHtml]).toEqual([`${company}: Your cleaner has arrived`, `${cleaner} has arrived at ${P}.`, `Hi! Your ${company} cleaner has arrived at ${P}.${liveTripLine}`, `<p>Your ${company} cleaner <strong>${cleaner}</strong> has arrived at <strong>${P}</strong> and will begin shortly.</p>${link("View job details")}`]);
    const started = buildClientJobMessage(w, "JOB_STARTED", company, P, cleaner, etaMinutes, liveTripUrl, scheduleNote);
    expect([started.subject, started.webBody, started.smsBody, started.emailHtml]).toEqual([`${company}: Cleaning has started`, `${cleaner} has started cleaning at ${P}.`, `Hi! Your ${company} cleaner has started cleaning at ${P}.`, `<p>Your ${company} cleaner <strong>${cleaner}</strong> has started cleaning at <strong>${P}</strong>.</p>`]);
    const done = buildClientJobMessage(w, "JOB_COMPLETE", company, P, cleaner, etaMinutes, liveTripUrl, scheduleNote);
    expect([done.subject, done.webBody, done.smsBody, done.emailHtml]).toEqual([`${company}: Cleaning is complete`, `The cleaning at ${P} is complete.`, `Hi! The cleaning at ${P} is complete. Thank you for choosing ${company}!`, `<p>The cleaning at <strong>${P}</strong> is complete.</p><p>Thank you for choosing <strong>${company}</strong>.</p>`]);
  });

  it("ETA words and schedule notes are unchanged", () => {
    expect(w.render("eta-soon", "SMS", {}).body).toBe("less than a minute away");
    expect(w.render("eta-minutes", "SMS", { etaMinutes: 12, minutesWord: "minutes", arrivalTime: "10:12 am" }).body).toBe(`about ${12} minute${"s"} away (arriving ~${"10:12 am"})`);
    expect(w.render("running-late", "SMS", { minutes: 15, startTime: "10:00" }).body).toBe(`Note: Your cleaner is running approximately ${15} minutes behind the scheduled start time of ${"10:00"}.`);
    expect(w.render("running-early", "SMS", { minutes: 20, startTime: "10:00" }).body).toBe(`Your cleaner is expected to arrive about ${20} minutes before the scheduled time of ${"10:00"}.`);
  });
});

describe("stock.urgent_need and stock.submission_low_stock", () => {
  it("urgent need notices are unchanged", () => {
    const w = defaultNotificationWording("stock.urgent_need");
    const need = { propertyName: P, itemName: "Toilet paper", stage: "REPORTED", observedCount: null as number | null, purchaseQuantity: 4, propertyId: "p 1" };
    const nextCleanAt = new Date("2026-11-14T00:00:00.000Z");
    const reviewPath = `/urgent-stock?propertyId=${encodeURIComponent(need.propertyId)}`;
    const base = { propertyName: need.propertyName, itemName: need.itemName, stage: need.stage, observedCount: need.observedCount ?? "unknown", purchaseQuantity: need.purchaseQuantity ?? "unknown", reviewPath };
    expect(w.render("opened", "INBOX", base)).toMatchObject({
      title: `Urgent stock: ${need.propertyName} — ${need.itemName}`,
      body: `Reported need remains open. ${need.stage}. Observed count: ${need.observedCount ?? "unknown"}; requested purchase: ${need.purchaseQuantity ?? "unknown"}. Review /urgent-stock?propertyId=${encodeURIComponent(need.propertyId)}`,
    });
    const kind = "Unresolved stock reminder";
    expect(w.render("reminder", "INBOX", { ...base, deadlineLine: w.line("deadline-line", "INBOX", { deadline: nextCleanAt.toISOString() }) }).body)
      .toBe(`${kind}. ${need.stage}. Observed count: ${need.observedCount ?? "unknown"}; requested purchase: ${need.purchaseQuantity ?? "unknown"}. ${nextCleanAt ? `Next clean planning deadline: ${nextCleanAt.toISOString()}. ` : ""}Review /urgent-stock?propertyId=${encodeURIComponent(need.propertyId)}`);
    expect(w.render("unknown", "INBOX", {}).body).toBe("unknown");
    expect(w.render("form-review", "INBOX", {})).toMatchObject({ title: "Urgent stock from a form needs review", body: "A job form counted stock below its urgent level, but the urgent need could not be raised yet. The submission is saved and this will be retried; check the property's stock." });
    for (const count of [1, 3]) {
      expect(w.render("count-review", "INBOX", { count, answersWord: count === 1 ? "answer" : "answers" })).toMatchObject({ title: "Stock count from a form needs review", body: `${count} stock count ${count === 1 ? "answer" : "answers"} on a job form could not be matched to this property's stock, so on-hand was not changed. Review them in Stock → Stock counts → Counts from job forms.` });
    }
  });

  it("low stock notices are unchanged", () => {
    const w = defaultNotificationWording("stock.submission_low_stock");
    const row = { itemName: "Bin liners", onHand: 2 };
    expect(w.render("low-stock", "INBOX", row)).toMatchObject({ title: "Low stock alert", body: `${row.itemName} is low at this property (${row.onHand} remaining).` });
    const body = `${3} low-stock items were added to an automatically created shopping run.`;
    expect(w.render("auto-run", "INBOX", { count: 3 })).toMatchObject({ title: "Auto shopping run created", body });
    expect(w.render("auto-run", "EMAIL", { count: 3 })).toMatchObject({ subject: "Auto shopping run created", html: `<p>${body}</p>` });
    expect(w.render("restock-review", "INBOX", {})).toMatchObject({ title: "Submission restock needs review", body: "Restock follow-up could not finish. The submission is saved; office should check its stock and shopping run. Internal reconciliation will retry." });
  });
});

describe("job.clock_changes", () => {
  it("every clock notice is unchanged", () => {
    const w = defaultNotificationWording("job.clock_changes");
    expect(w.render("auto-clock-out", "INBOX", { jobNumber: J, propertyName: P, time: "17:05" })).toMatchObject({ title: "Auto clocked out", body: `${J}: ${P} was automatically clocked out at ${"17:05"}.` });
    expect(w.render("left-site", "INBOX", {})).toMatchObject({ title: "Clocked out — left job site", body: "You've been clocked out — you left the job site. Resume the job if this was a mistake." });
    expect(w.render("left-site-office", "INBOX", { cleanerName: "Ana", jobLabel: `${J}: ${P}`, distance: 450 })).toMatchObject({ title: "Cleaner auto clocked out (left site)", body: `${"Ana"} left the site at ${`${J}: ${P}`} (~${450}m away) and was clocked out automatically.` });
    expect(w.render("auto-paused", "INBOX", { jobNumber: J, propertyName: P })).toMatchObject({ title: "Job auto-paused", body: `${J}: ${P} ran for over 24 hours and was automatically paused. Please open it and submit your checklist, or resume if you're still on site.` });
    for (const durationM of [95, null]) {
      expect(w.render("times-edited", "INBOX", { jobNumber: J, segmentTotal: w.line("segment-total", "INBOX", { minutes: durationM }, durationM != null) }).body)
        .toBe(`${J}: An admin amended your recorded clock times${durationM != null ? ` (new segment total: ${durationM} minutes)` : ""}.`);
    }
  });
});

describe("office.reports_generated, office.ical_alerts, leads.alerts", () => {
  it("report and iCal notices are unchanged", () => {
    expect(defaultNotificationWording("office.reports_generated").render("generated", "INBOX", { jobId: "job1" })).toMatchObject({ title: "Report generated (manual client share required)", body: `Report ${"job1"} generated. Use Share action to send to client.` });
    const w = defaultNotificationWording("office.ical_alerts");
    for (const urgent of [true, false]) {
      const importantPrefix = w.line("important-prefix", "INBOX", {}, urgent);
      const inbox = w.render(urgent ? "near-term" : "changes", "INBOX", { importantPrefix, propertyName: P, changeCount: 4, urgentCount: 2 });
      expect(inbox.title).toBe(`${urgent ? "IMPORTANT: " : ""}iCal sync changes - ${P}`);
      expect(inbox.body).toBe(urgent ? `${2} near-term job change(s) detected for ${P}.` : `${4} iCal sync change(s) detected for ${P}.`);
      const html = w.render("changes", "EMAIL", { subjectLine: inbox.title, heading: w.line(urgent ? "heading-urgent" : "heading", "EMAIL", {}), propertyName: P, runId: "r1", syncedAt: "13 Nov 2026 10:00", nearTermParagraph: w.line("near-term-paragraph", "EMAIL", {}, urgent), summaryHtml: "<ul></ul>", changedJobsHtml: "", warningsHtml: "", propertyUrl: "https://a/p", integrationsUrl: "https://a/i" }).html;
      expect(html).toBe(`
    <h2 style="margin:0 0 12px;">${urgent ? "Important iCal sync change detected" : "iCal sync change summary"}</h2>
    <p><strong>Property:</strong> ${P}</p>
    <p><strong>Run:</strong> ${"r1"}</p>
    <p><strong>Synced at:</strong> ${"13 Nov 2026 10:00"}</p>
    ${
      urgent
        ? `<p style="color:#b91c1c;font-weight:700;">Changes affect jobs scheduled today, tomorrow, or within the next 48 hours.</p>`
        : ""
    }
    ${"<ul></ul>"}
    ${""}
    ${""}
    <p><a href="${"https://a/p"}">Open property</a> - <a href="${"https://a/i"}">Open integrations</a></p>
  `);
    }
    expect(w.render("near-term", "SMS", { propertyName: P, urgentJobs: "J-1 Thu; J-2 Fri" }).body).toBe(`IMPORTANT iCal sync for ${P}: ${"J-1 Thu; J-2 Fri"}`);
  });

  it("lead alert emails are unchanged", () => {
    const w = defaultNotificationWording("leads.alerts");
    for (const note of ["Before 10", null]) {
      const addon = w.render("addon", "EMAIL", { quoteRef: "ABC1234", clientName: "Sam", serviceType: "deep clean", addonList: "<li>x</li>", clientNoteParagraph: w.line("client-note", "EMAIL", { note }, Boolean(note)), quoteId: "q1" });
      expect(addon.subject).toBe(`Add-on request on quote ${"ABC1234"} from ${"Sam"}`);
      expect(addon.html).toBe(`
            <h2 style="margin:0 0 12px 0;">Add-on request — quote ${"ABC1234"}</h2>
            <p style="margin:0 0 8px 0;"><strong>${"Sam"}</strong> asked about these add-ons on their ${"deep clean"} quote:</p>
            <ul style="margin:0 0 12px 0;padding-left:20px;">
              ${"<li>x</li>"}
            </ul>
            ${note ? `<p style="margin:0 0 8px 0;"><strong>Client note:</strong> ${note}</p>` : ""}
            <p style="margin:0;color:#6b7280;font-size:13px;">Quote ID: ${"q1"}</p>
          `);
      const response = w.render("response", "EMAIL", { quoteRef: "ABC1234", verdict: "accepted", clientName: "Sam", serviceType: "deep clean", total: "$100.00", clientNoteParagraph: w.line("client-note", "EMAIL", { note }, Boolean(note)), quoteId: "q1" });
      expect(response.subject).toBe(`Quote ${"ABC1234"} ${"accepted"} by ${"Sam"}`);
      expect(response.html).toBe(`
            <h2 style="margin:0 0 12px 0;">Quote ${"ABC1234"} ${"accepted"}</h2>
            <p style="margin:0 0 8px 0;"><strong>${"Sam"}</strong> has ${"accepted"} their ${"deep clean"} quote (total $${Number(100).toFixed(2)}).</p>
            ${note ? `<p style="margin:0 0 8px 0;"><strong>Client note:</strong> ${note}</p>` : ""}
            <p style="margin:0;color:#6b7280;font-size:13px;">Quote ID: ${"q1"}</p>
          `);
    }
    expect(w.render("counter-offer", "EMAIL", { leadName: "Sam", quoteHtml: "<p>doc</p>" })).toMatchObject({ subject: `Counter offer for ${"Sam"}`, html: "<p>doc</p>" });
  });
});

describe("maintenance.assignment and office.field_alerts", () => {
  it("maintenance notices are unchanged", () => {
    const w = defaultNotificationWording("maintenance.assignment");
    expect(w.render("assigned", "INBOX", { propertyName: P, itemTitle: "Fix tap" })).toMatchObject({ title: "New maintenance job assigned", body: `${P}: ${"Fix tap"}` });
    const subject = w.render("assigned", "EMAIL", { itemTitle: "Fix tap", propertyName: P, companyName: "sNeek", userName: "Bo", roleLabel: "Plumber", detailRows: "<tr></tr>" }).subject;
    expect(subject).toBe(`Maintenance assigned — ${"Fix tap"} (${P}) · ${"sNeek"}`);
    const pay = (partId: string, values: Record<string, string>, lines: { now?: boolean; still?: boolean }, place: string | null, note: string | null) => w.render(partId, "EMAIL", {
      recipientName: "Bo", itemTitle: "Fix tap", ...values, companyName: "sNeek",
      nowPays: w.line("now-pays", "EMAIL", { pay: values.pay }, lines.now ?? false),
      stillPays: w.line("still-pays", "EMAIL", { previousPay: values.previousPay }, lines.still ?? false),
      placeSuffix: w.line("place-suffix", "EMAIL", { place }, Boolean(place)),
      noteParagraph: w.line("note-paragraph", "EMAIL", { note }, Boolean(note)),
    });
    const legacy = (line: string, place: string | null, note: string | null) => [`<p>Hi ${"Bo"},</p>`, `<p>${line}${place ? ` (${place})` : ""}</p>`, note ? `<p><strong>Note:</strong> ${note}</p>` : "", `<p>— ${"sNeek"}</p>`].join("");
    expect(pay("pay-changed", { pay: "$180.00 fixed", previousPay: "$150.00 fixed" }, {}, P, "Updated").html).toBe(legacy(`The pay for <strong>${"Fix tap"}</strong> is now ${"$180.00 fixed"} (was ${"$150.00 fixed"}).`, P, "Updated"));
    expect(pay("pay-set", { pay: "$180.00 fixed", previousPay: "" }, {}, null, null).html).toBe(legacy(`<strong>${"Fix tap"}</strong> pays ${"$180.00 fixed"}.`, null, null));
    expect(pay("price-approved", { pay: "$200.00 fixed", previousPay: "" }, { now: true }, P, null).html).toBe(legacy(`Your price for <strong>${"Fix tap"}</strong> was approved${` — it now pays ${"$200.00 fixed"}`}.`, P, null));
    expect(pay("price-declined", { pay: "", previousPay: "$150.00 fixed" }, { still: true }, P, null).html).toBe(legacy(`Your price request for <strong>${"Fix tap"}</strong> was not approved${`, so it still pays ${"$150.00 fixed"}`}.`, P, null));
  });

  it("field alerts are unchanged", () => {
    const w = defaultNotificationWording("office.field_alerts");
    for (const [distance, note] of [[120, "Gate code wrong"], [null, null]] as const) {
      const body = w.render("gps-adjusted", "INBOX", { propertyName: P, cleanerName: "Ana", distanceSuffix: w.line("distance-suffix", "INBOX", { distance }, distance != null), noteSuffix: w.line("note-suffix", "INBOX", { note }, Boolean(note)) }).body;
      expect(body).toBe(`${P}: ${"Ana"} manually adjusted their check-in location${distance != null ? ` (~${distance}m from property)` : ""}.${note ? ` Note: ${note}` : ""}`);
    }
    expect(w.render("off-site-start", "INBOX", { propertyName: P, cleanerName: "Ana", distance: 300, reason: "Parking", noteSuffix: "" }).body).toBe(`${P}: ${"Ana"} started ~${300}m away — ${"Parking"}.`);
    const overdue = w.render("safety-overdue", "INBOX", { place: P, minutes: 95, forCleaners: w.line("for-cleaners", "INBOX", { cleanerNames: "Ana, Bo" }) });
    expect(overdue).toMatchObject({ title: "Safety check-in overdue", body: `${P}: no safety check-in has been recorded ${95} minutes after arrival${` for ${"Ana, Bo"}`}.` });
    expect(w.render("safety-overdue", "EMAIL", { messageText: overdue.body, jobNumber: "1061" }).html).toBe(`<p>${overdue.body}</p><p><strong>Job:</strong> #${"1061"}</p>`);
    expect(w.render("maintenance-flagged", "INBOX", { priority: "URGENT", propertyName: P, itemTitle: "Leak", areaSuffix: w.line("area-suffix", "INBOX", { area: "Bathroom" }), action: "repair" })).toMatchObject({ title: `Maintenance flagged (${"URGENT"}) — ${P}`, body: `${"Leak"}${` · ${"Bathroom"}`} (${"repair"})` });
    expect(w.render("maintenance-visit", "INBOX", { event: "complete", workerName: "Bo", propertyName: P, itemTitle: "Leak", outcomeSuffix: w.line("outcome-suffix", "INBOX", { outcome: "fixed" }) })).toMatchObject({ title: `Maintenance: ${"complete"}`, body: `${"Bo"} — ${P}: ${"Leak"}${` (${"fixed"})`}` });
    expect(w.render("maintenance-completed", "INBOX", { actorName: "Bo", itemTitle: "Leak", propertyName: P, noteSuffix: "" })).toMatchObject({ title: `Maintenance completed — ${"Leak"}`, body: `${"Bo"} finished ${"Leak"} at ${P}.` });
    expect(w.render("price-requested", "INBOX", { actorName: "Bo", amount: "$90.00", itemTitle: "Leak", currentPay: w.line("unpriced", "INBOX", {}), reasonSuffix: w.line("reason-suffix", "INBOX", { note: "Parts" }) })).toMatchObject({ title: `Price change requested — ${"Leak"}`, body: `${"Bo"} asked for $${(90).toFixed(2)} on ${"Leak"} (currently ${"unpriced"}).${` Reason: ${"Parts"}`}` });
    const damage = { companyName: "sNeek", propertyName: P, title: "Cracked tile", descriptionParagraph: w.line("description-paragraph", "EMAIL", { description: "Near shower" }), severitySuffix: w.line("severity-suffix", "EMAIL", { severity: "HIGH" }), caseUrl: "https://a/c", maintenanceUrl: "https://a/m" };
    expect(w.render("damage-client", "EMAIL", damage)).toMatchObject({ subject: `${"sNeek"} - Damage reported at ${P}`, html: `
            <p>We reported damage at <strong>${P}</strong> and have raised a repair for it.</p>
            <p><strong>${"Cracked tile"}</strong></p>
            ${`<p>${"Near shower"}</p>`}
            <p>We will keep you updated as the repair progresses.</p>
          ` });
    expect(w.render("damage-client", "SMS", damage).body).toBe(`${"sNeek"}: damage reported at ${P} - ${"Cracked tile"}. A repair has been raised.`);
    expect(w.render("damage-office", "EMAIL", damage).html).toBe(`
          <p>A DAMAGE case was opened at <strong>${P}</strong> and a maintenance item was created automatically.</p>
          <p><strong>${"Cracked tile"}</strong>${` (${"HIGH"})`}</p>
          ${`<p>${"Near shower"}</p>`}
          <p><a href="${"https://a/c"}">Open the case</a> · <a href="${"https://a/m"}">Open the repair</a></p>
        `);
    expect(w.render("damage-critical", "SMS", damage).body).toBe(`${"sNeek"}: CRITICAL damage at ${P} - ${"Cracked tile"}. Repair raised.`);
  });
});

describe("office.cleaner_requests and office.client_requests", () => {
  it("cleaner request notices are unchanged", () => {
    const w = defaultNotificationWording("office.cleaner_requests");
    expect(w.render("job-extra-pay", "INBOX", { propertyName: P, requestTitle: "Oven", currency: "AUD", amount: "40.00" }).body).toBe(`${P}: ${"Oven"} (${"AUD"} ${"40.00"})`);
    expect(w.render("continuation", "INBOX", { jobId: "j1" })).toMatchObject({ title: "Continuation request pending", body: `Job ${"j1"} requires continuation approval.` });
    expect(w.render("started-early", "INBOX", { actorName: "Ana", jobType: "AIRBNB TURNOVER", propertyName: P, today: "2026-11-12", scheduledDate: "2026-11-13", timezone: "Australia/Sydney" }).body).toBe(`${"Ana"} started ${"AIRBNB TURNOVER"} at ${P} on ${"2026-11-12"} (scheduled ${"2026-11-13"}, ${"Australia/Sydney"}).`);
    expect(w.render("clock-adjustment", "INBOX", { propertyName: P, cleanerName: "Ana" })).toMatchObject({ title: "Clock adjustment approval needed", body: `${P}: ${"Ana"} requested a clock adjustment review.` });
    expect(w.render("reclean-submitted", "INBOX", { propertyName: P, areaCount: 2 }).body).toBe(`${P}: the cleaner re-did ${2} flagged area(s) and uploaded after photos/videos. Review the before vs after.`);
    expect(w.line("late-checkout", "INBOX", { time: "11:00" })).toBe(`Late checkout until ${"11:00"}`);
    expect(w.line("early-checkin", "INBOX", { time: w.line("time-tbd", "INBOX", {}) })).toBe(`Early check-in due by ${"time TBD"}`);
    const timing = w.render("timing-request", "EMAIL", { jobRef: J, propertyName: P, updateType: w.line("type-late", "EMAIL", {}), requestedTimeParagraph: w.line("requested-time", "EMAIL", { time: "11:00" }), adminNoteParagraph: w.line("admin-note", "EMAIL", { note: "Guests leave late" }), reviewUrl: "https://a/r" });
    expect(timing.subject).toBe(`Timing update approval requested - ${J}`);
    expect(timing.html).toBe(`
            <p>Hello,</p>
            <p>An admin timing update needs your approval for <strong>${P}</strong>.</p>
            <p><strong>Update type:</strong> ${"Late checkout"}</p>
            ${`<p><strong>Requested time:</strong> ${"11:00"}</p>`}
            ${`<p><strong>Admin note:</strong> ${"Guests leave late"}</p>`}
            <p><a href="${"https://a/r"}">Review and respond</a></p>
          `);
    expect(w.render("timing-request", "SMS", { detail: "D", reviewUrl: "https://a/r" }).body).toBe(`${"D"} Review: ${"https://a/r"}`);
    for (const n of [1, 3]) {
      const values = { companyName: "sNeek", count: n, requestWord: n === 1 ? "request" : "requests", total: "$90.00", agingHours: 24, requestRows: "<tr></tr>", actionUrl: "https://a/p" };
      expect(w.render("pay-reminder", "INBOX", values)).toMatchObject({ title: `${"sNeek"}: ${n} extra-pay request${n === 1 ? "" : "s"} awaiting approval`, body: `${n} extra-pay request${n === 1 ? "" : "s"} awaiting approval — ${"$90.00"} total.` });
    }
  });

  it("client request notices are unchanged", () => {
    const w = defaultNotificationWording("office.client_requests");
    const booking = { clientName: "Sam", propertyName: P, service: "DEEP CLEAN".replace(/_/g, " "), date: "2026-11-20", booking: w.line("booking-label", "INBOX", { service: "DEEP CLEAN", date: "2026-11-20" }), notesItem: w.line("notes-item", "EMAIL", { note: "Ladder" }) };
    expect(w.render("booking", "INBOX", booking)).toMatchObject({ title: `Booking request awaiting approval: ${P}`, body: `${"Sam"} requested ${`${"DEEP CLEAN"} on ${"2026-11-20"}`} for ${P}. Approve it to create the job.` });
    expect(w.render("booking", "EMAIL", booking).html).toBe(`
          <p>A client requested a booking. It is <strong>not scheduled yet</strong> — approve it in Approvals to create the job.</p>
          <ul>
            <li><strong>Client:</strong> ${"Sam"}</li>
            <li><strong>Property:</strong> ${P}</li>
            <li><strong>Service:</strong> ${"DEEP CLEAN"}</li>
            <li><strong>Date:</strong> ${"2026-11-20"}</li>
            ${`<li><strong>Notes:</strong> ${"Ladder"}</li>`}
          </ul>
        `);
    for (const reason of ["Away", undefined]) {
      expect(w.render("skip", "INBOX", { propertyName: P, reasonEnding: reason ? w.line("skip-reason", "INBOX", { reason }) : w.line("skip-no-reason", "INBOX", {}) }).body).toBe(`${P} requested to skip a scheduled clean${reason?.trim() ? `: ${reason.trim()}` : "."}`);
    }
    const jobLabel = w.line("job-label", "INBOX", { jobNumberLabel: ` #${J}`, propertyLabel: ` (${P})` });
    expect(jobLabel).toBe(` about job${` #${J}`}${` (${P})`}`);
    expect(w.render("message", "INBOX", { clientName: "Sam", jobLabel }).body).toBe(`${"Sam"} sent a new message${jobLabel} in the client portal.`);
    expect(w.render("message", "EMAIL", { clientName: "Sam", jobLabel, message: "Hello" })).toMatchObject({ subject: `New client message from ${"Sam"}`, html: `<p><strong>${"Sam"}</strong> sent a new portal message${jobLabel}.</p><p>${"Hello"}</p>` });
    expect(w.render("counter-offer", "INBOX", { approvalTitle: "Oven", asked: "AUD 40.00", offered: "AUD 30.00" }).body).toBe(`${"Oven"}: asked ${"AUD"} ${"40.00"}, client offered ${"AUD"} ${"30.00"}`);
    expect(w.render("decision", "INBOX", { approvalTitle: "Oven", decision: "approved", amount: "AUD 40.00" })).toMatchObject({ title: `Client approval ${"approved"}`, body: `${"Oven"} (${"AUD"} ${"40.00"})` });
    const relay = w.render("relayed", "INBOX", { jobRef: `#${J}`, propertyName: P, excerpt: "Hi", actorName: "Hannah" });
    expect([relay.title.trim(), relay.body]).toEqual([`Message from the client — job ${`#${J}`}`.trim(), `${P}: “${"Hi"}” (relayed by ${"Hannah"})`]);
  });
});

describe("job.changed, job.qa_and_accountability, client.post_job, workforce.updates", () => {
  it("job change notices are unchanged", () => {
    const w = defaultNotificationWording("job.changed");
    const reset = w.render("reset", "INBOX", { jobNumber: J, propertyName: P, clearedText: ["your clock records", "the submitted form and photos"].join(" and ") });
    const legacyReset = `${J} at ${P} has been reset by admin — ${"your clock records and the submitted form and photos"} were cleared. Please start the job again from your app.`;
    expect(reset).toMatchObject({ title: "Job reset by admin", body: legacyReset });
    expect(w.render("reset", "EMAIL", { jobNumber: J, propertyName: P, clearedText: "your clock records and the submitted form and photos" }).html).toBe(`<h2 style="margin:0 0 12px;">Job reset</h2><p>${legacyReset}</p>`);
    const schedule = `${"2026-11-14"}${w.line("schedule-start", "INBOX", { startTime: "10:00" })}${w.line("schedule-finish", "INBOX", { dueTime: "13:00" })}`;
    expect(schedule).toBe(`${"2026-11-14"}${` at ${"10:00"}`}${`, finish by ${"13:00"}`}`);
    expect(w.render("rescheduled", "SMS", { schedule }).body).toBe(`Job rescheduled: ${schedule}. Open the job to review.`);
    expect(w.render("tasks-added", "INBOX", { companyName: "sNeek", taskWord: "tasks", jobNumber: J, propertyName: P, taskListText: "A, B" })).toMatchObject({ title: `${"sNeek"}: extra task${"s"} added`, body: `${J} at ${P}: ${"A, B"}` });
    expect(w.render("tasks-added", "EMAIL", { companyName: "sNeek", taskWord: "task", jobNumber: J, propertyName: P, taskList: "<li>A</li>" }).html).toBe(`
        <h2 style="margin:0 0 12px;">Extra task${""} added</h2>
        <p><strong>${J}</strong> at <strong>${P}</strong> now includes:</p>
        <ul style="padding-left:18px;margin:12px 0;">${"<li>A</li>"}</ul>
        <p>Open the job before you start so you have the full list.</p>
      `);
    const note = "Please hurry";
    const asked = w.render("client-eta", "INBOX", { jobNumber: J, propertyName: P, noteQuote: w.line("note-quote", "INBOX", { note }) });
    expect(asked).toMatchObject({ title: "Client asked for an ETA", body: `${J} at ${P}${note ? ` — “${note}”` : ""}` });
    expect(w.render("task-declined", "SMS", { taskTitle: "Oven", jobNumber: J }).body).toBe(`Declined: ${"Oven"} for ${J}.`);
    const updated = w.render("job-updated", "EMAIL", { companyName: "sNeek", templateSubject: "Job updated", attentionSuffix: w.line("attention-suffix", "EMAIL", {}), jobNumber: J, propertyName: P, changeList: "<li>x</li>" });
    expect(updated.subject).toBe(`${"sNeek"}: ${"Job updated"}`);
    expect(updated.html).toBe(`
          <h2 style="margin:0 0 12px;">Job updated${" - immediate attention"}</h2>
          <p><strong>${J}</strong> for <strong>${P}</strong> has been updated.</p>
          <ul style="padding-left:18px;margin:12px 0;">${"<li>x</li>"}</ul>
          <p>Open the job for the latest instructions and schedule details.</p>
        `);
  });

  it("accountability notices are unchanged", () => {
    const w = defaultNotificationWording("job.qa_and_accountability");
    const where = w.line("where", "INBOX", { propertyName: P });
    const mr = w.render("management-review", "INBOX", { where, whoDash: w.line("who-dash", "INBOX", { cleanerName: "Ana" }), reasonSentence: w.line("reason-sentence", "INBOX", { reason: "Critical issue" }) });
    expect(mr).toMatchObject({ title: `QA flagged for management review${` at ${P}`}`, body: `A QA inspection${` at ${P}`}${` — ${"Ana"}`} was routed to management review.${` ${"Critical issue"}`}` });
    const shellLegacy = (title: string, body: string, url?: string, label?: string) => `<div style="font-family:Arial,sans-serif;color:#111;">
    <h2 style="margin:0 0 8px;">${title}</h2>
    <div style="color:#555;margin:0 0 12px;"><p>${body}</p></div>
    ${
      url
        ? `<p style="margin:16px 0;"><a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">${
            label ?? "Open"
          }</a></p>`
        : ""
    }
  </div>`;
    const mrEmail = w.render("management-review", "EMAIL", { companyName: "sNeek", title: mr.title, messageText: mr.body, actionUrl: "https://a/j" });
    expect(mrEmail).toMatchObject({ subject: `${"sNeek"}: ${mr.title}`, html: shellLegacy(mr.title, mr.body, "https://a/j", "Review job") });
    const rework = w.render("rework-offer", "INBOX", { where, minutes: 30, reasonSentence: w.line("rework-reason", "INBOX", { reason: "Missed mirror" }) });
    expect(rework.body).toBe([`QA flagged items on your clean${` at ${P}`}.`, `Reason: ${"Missed mirror"}`, "You can go back and fix it yourself at no cost to you. If you decline or the offer lapses, it is reassigned to another cleaner and the rework pay is deducted from your job."].filter(Boolean).join(" "));
    expect(w.render("rework-offer", "SMS", { companyName: "sNeek", title: rework.title }).body).toBe(`${"sNeek"}: ${rework.title}. Open the app to accept or decline.`);
    expect(w.render("bonus-approved", "INBOX", { bonusTitle: "streak bonus", amountSuffix: w.line("amount-suffix", "INBOX", { amount: "50.00" }) })).toMatchObject({ title: `Bonus approved${` ($${"50.00"})`}`, body: `Your ${"streak bonus"} has been approved${` ($${"50.00"})`} and will be included in payroll.` });
    const streak = w.render("streak", "INBOX", { streak: 3, cleanWord: "cleans", toGo: w.line("to-go", "INBOX", { remaining: 2 }) });
    expect(streak.body).toBe(`You're on a streak of ${3} high-quality clean${"s"}.${` ${2} more to your next bonus.`}`);
    // The email receives the inbox text as a value, so its apostrophe is escaped (renders the same).
    expect(w.render("streak", "EMAIL", { title: streak.title, messageText: streak.body }).html).toBe(shellLegacy(streak.title, escapeHtml(streak.body)));
    expect(w.render("rework-transfer", "INBOX", { propertyName: P, severity: "Major", qaName: "Qi", minutes: 20, amount: "$15.00", cleanerName: "Ana" }).body).toBe(`${P}: ${"Major"} rework flagged by ${"Qi"} — ${20} min / $${(15).toFixed(2)} proposed to move from ${"Ana"}.`);
    expect(w.render("complete-form", "INBOX", { place: P }).body).toBe(`QA has started inspecting ${P}. Please complete and submit your job form now.`);
  });

  it("post-job emails are unchanged", () => {
    const w = defaultNotificationWording("client.post_job");
    const values = { clientName: "Sam", service: "deep clean", propertyName: `${P}, Manly`, propertyShort: P, cleanDate: "2026-11-12", jobNumber: J, ratingUrl: "https://a/r", quoteUrl: "https://a/q" };
    expect(w.render("follow-up-1d", "EMAIL", values)).toMatchObject({ subject: `Thank you for choosing sNeek - ${J}`, html: `
        <h2 style="margin:0 0 12px;">Thanks for booking with sNeek</h2>
        <p>Hello ${"Sam"},</p>
        <p>Thank you for trusting us with your ${"deep clean"} at <strong>${`${P}, Manly`}</strong>.</p>
        <p>Your service dated <strong>${"2026-11-12"}</strong> has been completed and recorded in the system.</p>
        <p>If you need anything further, just reply to this email and our team will take care of it.</p>
      ` });
    expect(w.render("follow-up-3d", "EMAIL", values).subject).toBe(`How was your clean at ${P}?`);
    expect(w.render("follow-up-rebook", "EMAIL", values).subject).toBe(`Ready for your next service at ${P}?`);
    expect(w.render("qa-invite", "EMAIL", { clientName: "Sam", propertyName: P, link: "https://a/f", hours: 72 }).html).toBe(`<p>Hi ${"Sam"},</p><p>We'd love your feedback on your recent clean at <strong>${P}</strong>. Please take a moment to rate the job:</p><p><a href="${"https://a/f"}">${"https://a/f"}</a></p><p>This link expires in ${72} hours.</p><p>— sNeek</p>`);
    expect(w.line("rule-default-subject", "INBOX", { propertyName: P })).toBe(`${P} update`);
    const body = "Line one\nLine two";
    expect(w.render("rule-email", "EMAIL", { subject: "S", messageHtml: body.replaceAll("\n", "<br />") }).html).toBe(`<p>${body.replaceAll("\n", "<br />")}</p>`);
  });

  it("workforce notices are unchanged", () => {
    const w = defaultNotificationWording("workforce.updates");
    expect(w.render("team-update", "INBOX", { postTitle: "Roster", postSummary: "Out now" })).toMatchObject({ title: "Team update", body: `${"Roster"} - ${"Out now"}` });
    expect(w.render("chat", "INBOX", { channelName: "Crew", messageSummary: "Hi" })).toMatchObject({ title: `Chat: ${"Crew"}`, body: "Hi" });
    const expired = w.render("document-expired", "INBOX", { documentTitle: "Police check", personName: "Ana" });
    expect(expired).toMatchObject({ title: `Expired document - ${"Police check"}`, body: `${"Police check"} for ${"Ana"} has expired and needs replacement.` });
    expect(w.render("document-expired", "EMAIL", { title: expired.title, messageText: expired.body }).html).toBe(`<p>${expired.body}</p>`);
    expect(w.render("credentials-expired", "INBOX", { expiredCount: 2, credentialWord: "credentials", lines: "a\nb" })).toMatchObject({ title: `${2} expired credential${"s"} in the team`, body: "a\nb" });
    expect(w.render("credentials-expiring", "INBOX", { count: 1, credentialWord: "credential", lines: "a" }).title).toBe(`${1} credential${""} expiring soon`);
    expect(w.render("recognition", "INBOX", { senderName: "Hannah", recognitionTitle: "Star" }).body).toBe(`${"Hannah"} sent you recognition: ${"Star"}`);
    expect(w.render("hiring-application", "INBOX", { candidateName: "Lee", positionTitle: "Cleaner" }).body).toBe(`${"Lee"} applied for ${"Cleaner"}`);
    const quiz = w.render("quiz", "EMAIL", { candidateName: "Lee", positionTitle: "Cleaner", quizSuffix: w.line("quiz-one", "EMAIL", { topic: "Linen" }), topicLabel: "Topic", topicLine: "Linen", link: "https://a/q" });
    expect(quiz.subject).toBe(`Knowledge check: ${"Linen"} — ${"Cleaner"}`);
    expect(quiz.html).toBe(`<p>Hi ${"Lee"},</p>
<p>Thanks for applying! As the next step, please complete this short knowledge check.</p>
<p><strong>Topic${""}:</strong> ${"Linen"}</p>
<p>It only takes a few minutes and is completed in one sitting.</p>
<p><a href="${"https://a/q"}" style="display:inline-block;background:#0f5a44;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Start the assessment</a></p>
<p>Or paste this link into your browser: ${"https://a/q"}</p>`);
    expect(w.render("quiz", "EMAIL", { candidateName: "Lee", positionTitle: "Cleaner", quizSuffix: w.line("quiz-many", "EMAIL", { count: 2 }), topicLabel: "Topics", topicLine: "x", link: "l" }).subject).toBe(`Knowledge check (${2} parts) — ${"Cleaner"}`);
    expect(w.render("hiring-interview", "EMAIL", { candidateName: "Lee", positionTitle: "Cleaner", interviewDate: "to be confirmed" })).toMatchObject({ subject: `Interview invitation - ${"Cleaner"}`, html: `<p>Hi ${"Lee"},</p><p>We would like to invite you to interview for ${"Cleaner"}.</p><p>Interview time: <strong>${"to be confirmed"}</strong></p><p>Please reply if you need to adjust the time.</p>` });
    expect(w.line("welcome-note", "EMAIL", {})).toBe("Complete your onboarding, upload your required documents, and start your assigned learning in the workforce hub.");
  });
});
