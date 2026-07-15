/**
 * Turns an assembled CleanerBriefing into a natural, friendly, 2nd-person
 * spoken script (~60–90s read). Plain sentences only — no markdown, no lists,
 * no symbols the speech engine would read aloud awkwardly. Sections are woven
 * in priority order and skipped entirely when empty.
 */
import type { CleanerBriefing } from "@/lib/briefing/types";

function joinNatural(items: string[]): string {
  const list = items.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

export function buildSpokenScript(
  b: Omit<CleanerBriefing, "spokenScript">,
  dayWord: "today" | "tomorrow"
): string {
  const parts: string[] = [];
  const name = b.greetingName?.trim() || "there";

  // Accept gate — the cleaner has PENDING (unaccepted) assignments to accept.
  const pendingCount = b.acceptGate?.items.length ?? 0;
  const count = b.jobsOverview?.count ?? 0;

  if (pendingCount > 0) {
    parts.push(
      `Hi ${name}. First up, you've got ${pendingCount} ${pendingCount === 1 ? "job" : "jobs"} waiting for you to accept — head to Jobs and accept ${pendingCount === 1 ? "it" : "them"} to lock ${pendingCount === 1 ? "it" : "them"} in.`
    );
    if (count === 0) {
      // Nothing accepted yet — the accept prompt is the whole briefing.
      parts.push("Once you've accepted, refresh and I'll walk you through the day.");
      return parts.join(" ");
    }
  }

  // Opening + job count (accepted jobs).
  if (count === 0) {
    parts.push(
      `Hi ${name}. You have no jobs booked ${dayWord}, so enjoy the ${dayWord === "today" ? "day" : "downtime"}.`
    );
    // Still mention weather if we have it, then return early.
    if (b.weather) {
      parts.push(`Quick weather note: ${b.weather.summary.replace(/·/g, "")}.`);
    }
    return parts.join(" ");
  }

  parts.push(
    pendingCount > 0
      ? `For the ${count} ${count === 1 ? "job" : "jobs"} you've already accepted, here's the plan for ${dayWord}.`
      : `Hi ${name}, here's your briefing for ${dayWord}. You've got ${count} ${count === 1 ? "job" : "jobs"} lined up.`
  );

  // Schedule highlights — first stop + any timing flags.
  const jobs = b.jobsOverview?.jobs ?? [];
  const first = jobs[0];
  if (first) {
    const when = first.startTime ? `at ${first.startTime}` : "with no fixed start time";
    parts.push(`You start at ${first.propertyName}${first.suburb ? ` in ${first.suburb}` : ""} ${when}.`);
  }
  const earlyOnes = jobs.filter((j) => j.earlyCheckin).map((j) => j.propertyName);
  if (earlyOnes.length > 0) {
    parts.push(
      `Watch the early check-in ${earlyOnes.length === 1 ? "deadline" : "deadlines"} at ${joinNatural(earlyOnes)} — those need to be finished on time.`
    );
  }
  const lateOnes = jobs.filter((j) => j.lateCheckout).map((j) => j.propertyName);
  if (lateOnes.length > 0) {
    parts.push(`${joinNatural(lateOnes)} ${lateOnes.length === 1 ? "has" : "have"} a later checkout, so no rush getting in there.`);
  }

  // New-to-you properties.
  if (b.newProperties && b.newProperties.items.length > 0) {
    const names = b.newProperties.items.map((p) => p.propertyName);
    const withRef = b.newProperties.items.some((p) => p.hasReferencePhotos);
    parts.push(
      `${names.length === 1 ? "A new property for you today" : "Some new properties for you today"}: ${joinNatural(names)}.${withRef ? " Check the reference photos before you start." : ""}`
    );
  }

  // Turnaround / priority watch.
  if (b.priorityWatch && b.priorityWatch.items.length > 0) {
    const top = b.priorityWatch.items[0];
    parts.push(`Keep an eye on timing at ${top.propertyName}. ${top.reason}`);
  }

  // Weather + traffic.
  if (b.weather) {
    let line = `Weather-wise it's ${b.weather.summary.replace(/·/g, "").replace(/\s+/g, " ").trim()}.`;
    if (b.weather.wetWeatherGear) line += " Bring your wet-weather gear.";
    if (b.weather.summary.trim()) parts.push(line);
    if (b.weather.trafficBuffer) parts.push(`${b.weather.trafficBuffer}.`);
  }

  // Special requests.
  if (b.specialRequests && b.specialRequests.items.length > 0) {
    const items = b.specialRequests.items.slice(0, 4);
    parts.push(`Don't forget the special requests: ${joinNatural(items)}.`);
  }

  // Low stock.
  if (b.lowStock && b.lowStock.items.length > 0) {
    const items = b.lowStock.items.slice(0, 3).map((s) => `${s.item} at ${s.property}`);
    parts.push(`Heads up on low stock: ${joinNatural(items)}${b.lowStock.moreCount > 0 ? ", plus a few more" : ""}. Top these up if you can.`);
  }

  // Laundry.
  if (b.laundry && b.laundry.totalTasks > 0) {
    parts.push(b.laundry.line);
  }

  // Supplies to bring.
  if (b.supplies && b.supplies.items.length > 0) {
    const items = b.supplies.items.slice(0, 4).map((s) => s.item);
    parts.push(`Pack the right gear: ${joinNatural(items)}.`);
  }

  // Earnings + finish time.
  if (b.earnings) {
    let line = `You're on track to earn about ${Math.round(b.earnings.amount)} dollars ${dayWord}, estimated.`;
    if (
      typeof b.earnings.weekToDate === "number" &&
      typeof b.earnings.lastWeek === "number" &&
      b.earnings.lastWeek > 0
    ) {
      const wtd = Math.round(b.earnings.weekToDate);
      const trend = b.earnings.weekToDate >= b.earnings.lastWeek ? "ahead of" : "behind";
      line += ` That puts you around ${wtd} dollars for the week so far, ${trend} last week.`;
    }
    parts.push(line);
  }
  if (b.finishTime) {
    const startPhrase = b.finishTime.assumedStart
      ? `if you start around ${b.finishTime.startTime}`
      : `starting at ${b.finishTime.startTime}`;
    parts.push(`You should wrap up around ${b.finishTime.finishTime} ${startPhrase}.`);
  }

  // Watch-outs.
  if (b.watchOuts && b.watchOuts.items.length > 0) {
    const top = b.watchOuts.items[0];
    parts.push(`One thing to watch: ${top.label.toLowerCase()} has come up before. ${top.advice}`);
  }

  // Complaints.
  if (b.complaints && b.complaints.items.length > 0) {
    const c = b.complaints.items[0];
    parts.push(`Also, ${c.property} had some recent feedback, so give it that bit of extra care.`);
  }

  // Last-visit context — surface the most useful flagged item.
  if (b.lastVisit && b.lastVisit.items.length > 0) {
    const flagged = b.lastVisit.items.find((v) => v.flags.length > 0);
    if (flagged) {
      parts.push(`Last visit at ${flagged.propertyName}, ${joinNatural(flagged.flags).toLowerCase()} ${flagged.flags.length === 1 ? "was" : "were"} flagged — double-check ${flagged.flags.length === 1 ? "it" : "them"} this time.`);
    }
  }

  // Reminders.
  if (b.reminders?.deviceLine) {
    parts.push("And a quick reminder to check the Ring and Minut devices where they're fitted.");
  }
  if (b.reminders && b.reminders.expiringDocuments.length > 0) {
    parts.push(`One admin note: ${joinNatural(b.reminders.expiringDocuments)} ${b.reminders.expiringDocuments.length === 1 ? "is" : "are"} due to expire soon.`);
  }

  parts.push("Have a great one.");
  return parts.join(" ");
}
