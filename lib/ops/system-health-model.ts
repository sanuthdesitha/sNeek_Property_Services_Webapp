/**
 * System health read model: turns what was read (HealthFacts) into the
 * screen's summary sentence, area cards, scheduled-work rows and the text
 * for "Copy details for support". Pure: no server imports, no clock reads
 * (the check time comes from the facts).
 *
 * Rules (board "Diagnostics", 2026-11-16):
 * - "Working" only after a recorded successful use or test. A configured
 *   service with no recorded use is "Key present" or "Not tested".
 * - A worker that has stopped reporting makes scheduled work, the queue and
 *   every task "Cannot tell from here"; its last recorded state is shown as
 *   history, never as healthy.
 * - Nothing missing becomes zero or success.
 * - The support text carries times, task names, counts and redacted error
 *   text: no secrets, tokens, client names, addresses or phone numbers.
 */
import { formatInTimeZone } from "date-fns-tz";
import { cronIntervalMinutes, describeCron, nextCronRun, previousCronRun } from "./cron-schedule";
import { scheduledTaskInfo } from "./scheduled-tasks";
import { redactSupportText } from "./support-redaction";
import { FAILURE_ALERT_AFTER } from "./worker-guard";
import type {
  AttentionItem,
  HealthArea,
  HealthFacts,
  HealthRow,
  HealthState,
  TaskFacts,
  TaskRow,
  TransportFacts,
  SystemHealthView,
} from "./system-health-types";

export const HEALTH_STATE_WORD: Record<HealthState, string> = {
  working: "Working",
  attention: "Needs attention",
  failing: "Not working",
  not_set_up: "Not set up",
  unknown: "Cannot tell from here",
};

export const SAFEGUARDS_HREF = "/v2/admin/notifications/safeguards";
export const XERO_SETTINGS_HREF = "/v2/admin/settings?tab=xero";
export const AI_CONFIGURATION_HREF = "/v2/admin/ai";
export const ICAL_SETTINGS_HREF = "/v2/admin/settings?tab=ical-sync";
export const PAYMENT_GATEWAYS_HREF = "/v2/admin/settings?tab=payment-gateways";
export const NOTIFICATIONS_HEALTH_HREF = "/v2/admin/notifications?tab=health";
export const HEALTH_EMAIL_TAB_HREF = "/v2/admin/diagnostics?tab=email";
export const HEALTH_UPLOADS_TAB_HREF = "/v2/admin/diagnostics?tab=uploads";

/** A task whose expected run is this late (and did not happen) reads as late. */
const LATE_GRACE_MS = 15 * 60_000;
/** Xero must be renewed within this many days to be flagged. */
const RENEW_SOON_DAYS = 7;
/** Uses older than this do not count as a recent successful use. */
const RECENT_USE_MS = 7 * 24 * 60 * 60_000;

/* ── Formatting ──────────────────────────────────────────────────────────── */

type Clock = { now: Date; timeZone: string };

function sameDay(clock: Clock, at: Date): boolean {
  return formatInTimeZone(at, clock.timeZone, "yyyy-MM-dd") === formatInTimeZone(clock.now, clock.timeZone, "yyyy-MM-dd");
}

/** "14:06" today, "Thu 12 Nov 14:06" otherwise, in the organisation time zone. */
export function formatHealthTime(iso: string | null | undefined, clock: Clock): string {
  if (!iso) return "not recorded";
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "not recorded";
  return sameDay(clock, at) ? formatInTimeZone(at, clock.timeZone, "HH:mm") : formatInTimeZone(at, clock.timeZone, "EEE d MMM HH:mm");
}

function formatDay(iso: string, clock: Clock): string {
  return formatInTimeZone(new Date(iso), clock.timeZone, "EEE d MMM");
}

function formatSeconds(ms: number | null): string {
  if (ms === null) return "";
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function isRecent(iso: string | null, clock: Clock): boolean {
  return Boolean(iso) && clock.now.getTime() - new Date(iso as string).getTime() <= RECENT_USE_MS;
}

/* ── Outside services ────────────────────────────────────────────────────── */

type Verdict = { state: HealthState; word: string };

/**
 * One rule for email, SMS and push: switched off or missing keys is "Not set
 * up"; unreadable counts are "Cannot tell"; failures with nothing handed over
 * is "Not working"; some failures "Needs attention"; a recorded hand-over is
 * "Working"; keys with no recorded use is "Not tested".
 */
function transportVerdict(facts: TransportFacts, stopped: boolean, clock: Clock): Verdict {
  if (facts.keyPresent === false) return { state: "not_set_up", word: "Not set up" };
  if (stopped) return { state: "attention", word: "Stopped" };
  if (facts.handedOver24h === null || facts.failed24h === null || facts.keyPresent === null) return { state: "unknown", word: HEALTH_STATE_WORD.unknown };
  if (facts.failed24h > 0 && facts.handedOver24h === 0) return { state: "failing", word: HEALTH_STATE_WORD.failing };
  if (facts.failed24h > 0) return { state: "attention", word: HEALTH_STATE_WORD.attention };
  if (facts.handedOver24h > 0 || isRecent(facts.lastHandedOverAt, clock)) return { state: "working", word: "Working" };
  return { state: "unknown", word: "Not tested" };
}

function countText(value: number | null, words: string): string {
  return value === null ? `${words}: not readable` : `${value} ${words}`;
}

function emailArea(facts: HealthFacts, clock: Clock): HealthArea {
  const email = facts.email;
  const verdict = transportVerdict(email, facts.safeguards.emergencyStop, clock);
  const bounce = email.bounceList === null ? "bounce list not readable" : `${email.bounceList} on bounce list`;
  const short = verdict.state === "not_set_up"
    ? "No email provider key"
    : verdict.word === "Not tested"
      ? `Key present · no send recorded · ${bounce}`
      : `${countText(email.handedOver24h, "handed over")} in 24 h · ${bounce}`;
  const rows: HealthRow[] = [
    { label: "Service", value: `${email.providerName ?? "Email provider"} · ${email.keyPresent ? "key present" : email.keyPresent === false ? "no key" : "key not readable"}` },
    { label: "Last 24 h", value: `${countText(email.handedOver24h, "handed over")} · ${countText(email.failed24h, "failed")} · ${countText(email.notSent24h, "not sent")}` },
    { label: "Last handed over", value: formatHealthTime(email.lastHandedOverAt, clock) },
    { label: "Bounce list", value: email.bounceList === null ? "Not readable" : `${plural(email.bounceList, "address", "addresses")} never sent to` },
    { label: "Delivered", value: "Only where the provider reports it; opens are recorded for campaigns only" },
  ];
  return {
    key: "email", title: "Email", service: true, ...verdict, short, rows,
    fix: { label: "Email tab: bounce list", href: HEALTH_EMAIL_TAB_HREF },
  };
}

function smsArea(facts: HealthFacts, clock: Clock): HealthArea {
  const sms = facts.sms;
  const switchedOff = sms.providerName === "none";
  const verdict: Verdict = switchedOff ? { state: "not_set_up", word: "Switched off" } : transportVerdict(sms, facts.safeguards.emergencyStop, clock);
  const short = switchedOff
    ? "SMS provider set to none"
    : verdict.state === "not_set_up"
      ? `${sms.providerName ?? "SMS"} credentials missing`
      : verdict.word === "Not tested"
        ? "Key present · no text recorded"
        : `${countText(sms.handedOver24h, "handed over")} · ${countText(sms.failed24h, "failed")} today`;
  return {
    key: "sms", title: "SMS", service: true, ...verdict, short,
    rows: [
      { label: "Service", value: `${sms.providerName ?? "SMS provider"} · ${sms.keyPresent ? "key present" : sms.keyPresent === false ? "no key" : "key not readable"}` },
      { label: "Last 24 h", value: `${countText(sms.handedOver24h, "handed over")} · ${countText(sms.failed24h, "failed")} · ${countText(sms.notSent24h, "not sent")}` },
      { label: "Last failure", value: formatHealthTime(sms.lastFailureAt, clock) },
      { label: "Emergency stop", value: facts.safeguards.readable ? (facts.safeguards.emergencyStop ? "On: only security messages leave" : "Off") : "Not readable" },
    ],
    fix: { label: "Sending safeguards: resume or keep paused", href: SAFEGUARDS_HREF },
  };
}

function pushArea(facts: HealthFacts, clock: Clock): HealthArea {
  const push = facts.push;
  const verdict = transportVerdict(push, facts.safeguards.emergencyStop, clock);
  const short = verdict.word === "Not tested" ? "Keys present · no alert recorded" : verdict.state === "not_set_up" ? "Browser push keys missing" : `last handed over ${formatHealthTime(push.lastHandedOverAt, clock)}`;
  return {
    key: "push", title: "Phone and browser alerts", service: true, ...verdict, short,
    rows: [
      { label: "Browser", value: `${push.keyPresent ? "Push keys present" : push.keyPresent === false ? "No push keys" : "Keys not readable"} · ${push.browsers === null ? "browsers not readable" : plural(push.browsers, "browser")}` },
      { label: "Last 24 h", value: `${countText(push.handedOver24h, "handed over")} · ${countText(push.failed24h, "failed")}` },
      { label: "Delivered", value: "Only when the app confirms" },
    ],
    fix: { label: "Notifications › Health", href: NOTIFICATIONS_HEALTH_HREF },
  };
}

function storageArea(facts: HealthFacts, clock: Clock): HealthArea {
  const storage = facts.storage;
  const failures = storage.unresolvedFailures;
  const failureText = failures === null ? "failed uploads not readable" : failures === 0 ? "no failed uploads" : `${plural(failures, "failed upload")} to look at`;
  let verdict: Verdict;
  if (storage.keyPresent === false) verdict = { state: "not_set_up", word: "Not set up" };
  else if (storage.keyPresent === null || storage.lastUploadAt === undefined) verdict = { state: "unknown", word: HEALTH_STATE_WORD.unknown };
  else if (isRecent(storage.lastUploadAt, clock)) verdict = { state: "working", word: "Working" };
  else verdict = { state: "unknown", word: "Not tested" };
  return {
    key: "storage", title: "File storage", service: true, ...verdict,
    short: verdict.state === "working" ? failureText : verdict.word === "Not tested" ? `Key present · no recent upload · ${failureText}` : verdict.state === "not_set_up" ? "No storage keys" : failureText,
    rows: [
      { label: "Service", value: `S3 storage · ${storage.keyPresent ? "key present" : storage.keyPresent === false ? "no key" : "key not readable"}` },
      { label: "Last upload", value: formatHealthTime(storage.lastUploadAt, clock) },
      { label: "Failed uploads", value: failures === null ? "Not readable" : failures === 0 ? "None unresolved" : `${failures} not resolved, from ${formatHealthTime(storage.oldestUnresolvedAt, clock)}` },
    ],
    fix: { label: "Uploads tab", href: HEALTH_UPLOADS_TAB_HREF },
  };
}

function aiArea(facts: HealthFacts, clock: Clock): HealthArea {
  const ai = facts.ai;
  let verdict: Verdict;
  if (!ai.readable) verdict = { state: "unknown", word: HEALTH_STATE_WORD.unknown };
  else if (ai.lastFailureAt && (!ai.lastOkAt || ai.lastFailureAt > ai.lastOkAt) && ai.okCalls24h === 0 && ai.failedCalls24h > 0) verdict = { state: "failing", word: HEALTH_STATE_WORD.failing };
  else if (ai.failedCalls24h > 0) verdict = { state: "attention", word: HEALTH_STATE_WORD.attention };
  else if (isRecent(ai.lastOkAt, clock)) verdict = { state: "working", word: "Working" };
  else verdict = { state: "unknown", word: "Not tested" };
  const provider = ai.lastOkProvider ?? "AI provider";
  return {
    key: "ai", title: "AI", service: true, ...verdict,
    short: verdict.word === "Not tested" ? "No successful AI call recorded" : verdict.state === "unknown" ? "AI calls not readable" : `${provider} · last ok ${formatHealthTime(ai.lastOkAt, clock)}`,
    rows: [
      { label: "Provider", value: ai.lastOkProvider ?? "No successful call recorded" },
      { label: "Last ok", value: ai.lastOkAt ? `${formatHealthTime(ai.lastOkAt, clock)}${ai.lastOkLatencyMs !== null ? `, ${formatSeconds(ai.lastOkLatencyMs)}` : ""}` : "Not recorded" },
      { label: "Last 24 h", value: ai.readable ? `${ai.okCalls24h} ok · ${ai.failedCalls24h} failed` : "Not readable" },
    ],
    fix: { label: "AI configuration", href: AI_CONFIGURATION_HREF },
  };
}

function mapsArea(facts: HealthFacts): HealthArea {
  const present = facts.maps.keyPresent;
  const verdict: Verdict = present === true ? { state: "unknown", word: "Key present" } : present === false ? { state: "not_set_up", word: "Not set up" } : { state: "unknown", word: HEALTH_STATE_WORD.unknown };
  return {
    key: "maps", title: "Maps and address search", service: true, ...verdict,
    short: present ? "Not tested · usage limits not visible here" : present === false ? "No Google Maps key" : "Key not readable",
    rows: [
      { label: "Service", value: "Google Maps and Places" },
      { label: "Last use", value: "Not recorded" },
      { label: "Limits", value: "Not visible from the app" },
    ],
    note: present ? 'Shown as "Key present", never "Working", because no use is recorded.' : undefined,
    fix: { label: "Settings › Integrations", href: "/v2/admin/settings?tab=integrations" },
  };
}

function icalArea(facts: HealthFacts, clock: Clock): HealthArea {
  const ical = facts.ical;
  let verdict: Verdict;
  if (!ical.readable) verdict = { state: "unknown", word: HEALTH_STATE_WORD.unknown };
  else if (ical.enabledFeeds === 0) verdict = { state: "not_set_up", word: "No feeds" };
  else if (ical.failing.length > 0) verdict = { state: "attention", word: `${ical.failing.length} failing` };
  else if (ical.lastRunAt) verdict = { state: "working", word: "Working" };
  else verdict = { state: "unknown", word: "Not tested" };
  const first = ical.failing[0];
  const failingNames = ical.failing.map((feed) => `${feed.propertyName}${feed.since ? ` since ${formatHealthTime(feed.since, clock)}` : ""}${feed.error ? `, "${redactSupportText(feed.error, 120)}"` : ""}`);
  return {
    key: "ical", title: "Calendar feeds (iCal)", service: true, ...verdict,
    word: ical.readable && ical.failing.length > 0 ? `${ical.failing.length} of ${ical.enabledFeeds} failing` : verdict.word,
    short: !ical.readable ? "Feed status not readable" : first ? `${first.propertyName}${ical.failing.length > 1 ? ` and ${ical.failing.length - 1} more` : ""}` : ical.enabledFeeds ? `${plural(ical.enabledFeeds, "feed")} ok` : "No feed switched on",
    rows: [
      { label: "Last run", value: `${formatHealthTime(ical.lastRunAt, clock)} · ${ical.readable ? `${ical.enabledFeeds - ical.failing.length} feeds ok` : "not readable"}` },
      ...(failingNames.length ? [{ label: "Failing", value: failingNames.join("; ") }] : []),
    ],
    fix: first ? { label: `Open ${first.propertyName} calendar settings`, href: `/v2/admin/properties/${first.propertyId}` } : { label: "Settings › iCal sync", href: ICAL_SETTINGS_HREF },
  };
}

function paymentsArea(facts: HealthFacts): HealthArea {
  const payments = facts.payments;
  const verdict: Verdict = !payments.readable ? { state: "unknown", word: HEALTH_STATE_WORD.unknown } : payments.activeGateways.length ? { state: "unknown", word: "Key present" } : { state: "not_set_up", word: "Not set up" };
  return {
    key: "payments", title: "Card payments", service: true, ...verdict,
    short: !payments.readable ? "Gateways not readable" : payments.activeGateways.length ? `${payments.activeGateways.join(", ")} · no use recorded here` : "Stripe, Square, PayPal: no keys",
    rows: ["STRIPE", "SQUARE", "PAYPAL"].map((provider) => ({
      label: provider.charAt(0) + provider.slice(1).toLowerCase().replace("pal", "Pal"),
      value: !payments.readable ? "Not readable" : payments.activeGateways.includes(provider) ? "Key present" : "No key",
    })),
    fix: { label: "Settings › Payment gateways", href: PAYMENT_GATEWAYS_HREF },
  };
}

function xeroArea(facts: HealthFacts, clock: Clock): HealthArea {
  const xero = facts.xero;
  let verdict: Verdict;
  const renewSoon = xero.renewBy !== null && new Date(xero.renewBy).getTime() - clock.now.getTime() <= RENEW_SOON_DAYS * 86_400_000;
  if (!xero.readable) verdict = { state: "unknown", word: HEALTH_STATE_WORD.unknown };
  else if (xero.notConnected) verdict = { state: "not_set_up", word: "Not connected" };
  else if (xero.state === "needs-reconnect" || xero.state === "reconnect-once") verdict = { state: "failing", word: "Reconnect needed" };
  else if (xero.state === "attention") verdict = { state: "attention", word: HEALTH_STATE_WORD.attention };
  else if (renewSoon && xero.renewBy) verdict = { state: "attention", word: `Renew by ${formatDay(xero.renewBy, clock)}` };
  else verdict = { state: "working", word: "Working" };
  return {
    key: "xero", title: "Xero", service: true, ...verdict,
    short: !xero.readable ? "Connection not readable" : xero.notConnected ? "No organisation connected" : `last renewal ${formatHealthTime(xero.lastRefreshedAt, clock)}`,
    rows: [
      { label: "Connected as", value: xero.tenantName ?? "Not connected" },
      { label: "Last renewal", value: formatHealthTime(xero.lastRefreshedAt, clock) },
      { label: "Renew by", value: xero.renewBy ? formatDay(xero.renewBy, clock) : "Not known" },
      { label: "Why renew", value: "Xero asks for a fresh sign-in if unused for 60 days" },
      ...(xero.reason ? [{ label: "Reason", value: xero.reason }] : []),
    ],
    fix: { label: verdict.state === "failing" ? "Settings › Xero: Reconnect" : "Settings › Xero", href: XERO_SETTINGS_HREF },
  };
}

/* ── Core areas ──────────────────────────────────────────────────────────── */

function workerKnown(facts: HealthFacts): boolean {
  return facts.worker.status === "ACTIVE";
}

export function workerNote(facts: HealthFacts, clock: Clock): string {
  const seen = facts.worker.lastSeenAt ? formatHealthTime(facts.worker.lastSeenAt, clock) : null;
  switch (facts.worker.status) {
    case "ACTIVE":
      return `The background worker last reported at ${seen}. Run times come from the runs it records.`;
    case "STALE":
      return `The background worker has not reported since ${seen}, so this page cannot tell whether scheduled work is running. Its last recorded runs are shown as history only.`;
    case "MISSING":
      return "The background worker has never reported to this database, so this page cannot tell whether scheduled work runs.";
    default:
      return "Whether the background worker is running could not be read.";
  }
}

function scheduledArea(facts: HealthFacts, rows: TaskRow[] | null): HealthArea {
  const base = { key: "scheduled", title: "Scheduled work", service: false, rows: [] as HealthRow[] };
  if (!workerKnown(facts)) {
    return { ...base, state: "unknown", word: HEALTH_STATE_WORD.unknown, short: facts.worker.status === "MISSING" ? "The worker has never reported" : "The worker stopped reporting" };
  }
  if (!rows) return { ...base, state: "unknown", word: HEALTH_STATE_WORD.unknown, short: "Run history could not be read" };
  const scheduled = rows.filter((row) => row.runs !== "not scheduled");
  const failing = rows.filter((row) => row.state === "failing").length;
  const late = rows.filter((row) => row.state === "attention").length;
  const onTime = scheduled.filter((row) => row.state === "working").length;
  const failedToday = rows.reduce((sum, row) => sum + (row.failure ? 1 : 0), 0);
  const state: HealthState = failing > 0 || late > 0 ? "attention" : onTime === scheduled.length ? "working" : "unknown";
  return {
    ...base,
    state,
    word: state === "unknown" ? "Not all known" : HEALTH_STATE_WORD[state],
    short: `${onTime} of ${scheduled.length} ran on time${failedToday ? ` · ${failedToday} failing` : ""}${late ? ` · ${late} late` : ""}`,
  };
}

function queueArea(facts: HealthFacts): HealthArea {
  const queue = facts.queue;
  const base = { key: "queue", title: "Job queue", service: false, rows: [] as HealthRow[] };
  if (!queue) return { ...base, state: "unknown", word: HEALTH_STATE_WORD.unknown, short: "Queue not readable" };
  const short = `${queue.waiting} waiting · ${queue.stuck} stuck`;
  if (!workerKnown(facts)) return { ...base, state: "unknown", word: HEALTH_STATE_WORD.unknown, short: `${short} · worker silent` };
  if (queue.stuck > 0 || queue.failed24h > 0) return { ...base, state: "attention", word: HEALTH_STATE_WORD.attention, short: `${short} · ${queue.failed24h} failed for good` };
  return { ...base, state: "working", word: "Working", short };
}

function databaseArea(facts: HealthFacts): HealthArea {
  const database = facts.database;
  const base = { key: "database", title: "Database", service: false, rows: [] as HealthRow[] };
  if (!database.reachable) return { ...base, state: "failing", word: HEALTH_STATE_WORD.failing, short: "Could not be reached" };
  const running = database.runningQueries === null ? "running queries not readable" : `${database.runningQueries} running`;
  const slowest = database.longestSeconds === null ? "" : ` · slowest ${database.longestSeconds} s`;
  const slow = (database.longestSeconds ?? 0) >= 60;
  return { ...base, state: slow ? "attention" : "working", word: slow ? HEALTH_STATE_WORD.attention : "Working", short: `${running}${slowest}` };
}

/* ── Scheduled work rows ─────────────────────────────────────────────────── */

/** A few common errors in plain words; anything else is said as "an error". */
export function plainFailure(error: string | null): string {
  const text = (error ?? "").toLowerCase();
  if (!text) return "it stopped without recording why";
  if (text.includes("handler timeout")) return "it took longer than its time limit, so the worker stopped waiting for it";
  if (/timeout|timed out|etimedout/.test(text)) return "an outside service or the database did not answer in time";
  if (/econnrefused|enotfound|fetch failed|network|socket hang up|econnreset/.test(text)) return "an outside service could not be reached";
  if (/p1001|p1002|can't reach database|connection pool|too many connections/.test(text)) return "the database did not answer";
  if (/unauthori[sz]ed|forbidden|401|403|invalid api key|invalid_grant/.test(text)) return "an outside service refused the app's credentials";
  return "it stopped with an error";
}

function lastRunWords(row: TaskFacts, clock: Clock): string {
  const run = row.lastRun;
  if (!run) return "No run recorded";
  const at = formatHealthTime(run.at, clock);
  if (run.skipped) return `Skipped ${at}: the previous run was still going`;
  if (run.ok === false) return `Failed ${at}`;
  if (run.ok === null) return `Ran ${at} · result not recorded`;
  return `Ok ${at}${run.durationMs !== null && run.durationMs > 0 ? ` · ${formatSeconds(run.durationMs)}` : ""}`;
}

function last24hWords(row: TaskFacts): string {
  const parts: string[] = [];
  if (row.ok24h) parts.push(`${row.ok24h} ok`);
  if (row.failed24h) parts.push(`${row.failed24h} failed`);
  if (row.unknown24h) parts.push(`${row.unknown24h} without a result`);
  return parts.length ? parts.join(" · ") : "No runs in 24 h";
}

export function buildTaskRow(row: TaskFacts, facts: HealthFacts, clock: Clock): TaskRow {
  const info = scheduledTaskInfo(row.name);
  const known = workerKnown(facts);
  const timeZone = row.timeZone ?? clock.timeZone;
  const nextAt = known && row.cron ? nextCronRun(row.cron, clock.now, timeZone) : null;
  let state: HealthState;
  let lastRunText = lastRunWords(row, clock);
  if (!known) {
    state = "unknown";
    lastRunText = row.lastRun ? `Cannot tell · last recorded: ${lastRunText.charAt(0).toLowerCase()}${lastRunText.slice(1)}` : "Cannot tell · no run recorded";
  } else if (!row.lastRun) {
    state = "unknown";
  } else if (row.lastRun.ok === false) {
    state = "failing";
  } else if (row.lastRun.ok === null) {
    state = "unknown";
  } else {
    // The last run that should have happened, allowing it time to start and finish.
    const expected = row.cron ? previousCronRun(row.cron, new Date(clock.now.getTime() - LATE_GRACE_MS), timeZone) : null;
    const late = expected !== null && new Date(row.lastRun.at).getTime() < expected.getTime() - 60_000;
    state = late ? "attention" : "working";
    if (late && expected) lastRunText = `Late: due ${formatHealthTime(expected.toISOString(), clock)}, last ran ${formatHealthTime(row.lastRun.at, clock)}`;
  }
  const failed = row.lastRun?.ok === false ? row.lastRun : null;
  const nextText = nextAt ? formatHealthTime(nextAt.toISOString(), clock) : null;
  const alerted = row.failuresInARow >= FAILURE_ALERT_AFTER;
  return {
    name: row.name,
    plainName: info.plainName,
    description: info.description,
    runs: row.cron ? describeCron(row.cron) : "not scheduled",
    state,
    lastRunText,
    lastRunAt: row.lastRun?.at ?? null,
    last24h: last24hWords(row),
    nextAt: nextAt ? nextAt.toISOString() : null,
    intervalMinutes: row.cron ? cronIntervalMinutes(row.cron, clock.now, timeZone) : null,
    failure: failed
      ? {
          at: failed.at,
          whatHappened: `the run at ${formatHealthTime(failed.at, clock)} failed: ${plainFailure(failed.error)}${failed.durationMs ? `, after ${formatSeconds(failed.durationMs)}` : ""}.`,
          whatItMeans: info.ifItFails,
          whatToDo: [
            nextText ? `nothing now; the next run at ${nextText} tries again.` : "it runs again on its schedule.",
            alerted
              ? `It has failed ${row.failuresInARow} times in a row, so administrators have one inbox notice.`
              : "If it fails again, administrators get one inbox notice.",
            info.fix ? `If it keeps failing, check ${info.fix.label}.` : "",
          ].filter(Boolean).join(" "),
          technical: [
            `Task: ${row.name}`,
            `Error: ${failed.error ? redactSupportText(failed.error, 500) : "not recorded"}`,
            `Run: ${formatInTimeZone(new Date(failed.at), clock.timeZone, "yyyy-MM-dd HH:mm:ss")}${failed.durationMs !== null ? ` · ${formatSeconds(failed.durationMs)}` : ""}`,
          ].join("\n"),
          fix: info.fix,
        }
      : null,
  };
}

const STATE_ORDER: Record<HealthState, number> = { failing: 0, attention: 1, unknown: 2, working: 3, not_set_up: 4 };

/** Failures first, then late, unknown and working; within a state, most frequent first. */
export function sortTaskRows(rows: TaskRow[]): TaskRow[] {
  return [...rows].sort((a, b) =>
    STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || (a.intervalMinutes ?? Number.MAX_SAFE_INTEGER) - (b.intervalMinutes ?? Number.MAX_SAFE_INTEGER)
    || a.plainName.localeCompare(b.plainName));
}

/* ── Summary and support text ───────────────────────────────────────────── */

function attentionItems(facts: HealthFacts, areas: HealthArea[], tasks: TaskRow[] | null, clock: Clock): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (!workerKnown(facts)) {
    items.push({ key: "worker", title: "Background worker", text: workerNote(facts, clock) });
  }
  if (facts.safeguards.readable && facts.safeguards.emergencyStop) {
    items.push({ key: "emergency-stop", title: "Sending safeguards", text: "the emergency stop is on, so only security messages leave; the inbox still works.", fix: { label: "Open Sending safeguards", href: SAFEGUARDS_HREF } });
  }
  if (facts.safeguards.readable && facts.safeguards.paused.length) {
    const labels = facts.safeguards.paused.slice(0, 3).map((pause) => pause.label).join(", ");
    items.push({
      key: "paused",
      title: "Sending safeguards",
      text: `${plural(facts.safeguards.paused.length, "pause is", "pauses are")} on (${labels}${facts.safeguards.paused.length > 3 ? ", …" : ""}); email, SMS and push to them wait until an administrator resumes.`,
      fix: { label: "Open Sending safeguards", href: SAFEGUARDS_HREF },
    });
  }
  for (const row of tasks ?? []) {
    if (row.state === "failing" && row.failure) {
      items.push({ key: `task:${row.name}`, title: row.plainName, text: `${row.failure.whatHappened} ${row.failure.whatItMeans}`, fix: row.failure.fix });
    } else if (row.state === "attention") {
      items.push({ key: `task:${row.name}`, title: row.plainName, text: `${row.lastRunText}.` });
    }
  }
  for (const area of areas) {
    if (area.key === "scheduled") continue;
    if (area.state !== "attention" && area.state !== "failing") continue;
    // Stopped by the emergency stop: already said once above.
    if (area.word === "Stopped") continue;
    items.push({ key: area.key, title: area.title, text: areaAttentionText(area), fix: area.fix });
  }
  return items;
}

function areaAttentionText(area: HealthArea): string {
  switch (area.key) {
    case "xero":
      return area.state === "failing" ? "the connection must be reconnected before invoices can sync." : `${area.word.toLowerCase()} or invoices stop syncing.`;
    case "ical":
      return `${area.short}: the feed is failing, so new bookings there are not arriving.`;
    case "database":
      return area.state === "failing" ? "the database could not be reached." : `a query has been running a long time (${area.short}).`;
    default:
      return `${area.word.toLowerCase()}: ${area.short}.`;
  }
}

function summarySentence(needs: number, areas: HealthArea[]): string {
  const head = needs === 0 ? "Nothing needs you." : needs === 1 ? "1 thing needs you." : `${needs} things need you.`;
  const unconfirmed = areas.filter((area) => area.state === "unknown");
  if (unconfirmed.length === 0) {
    return `${head} Everything else ${needs === 0 ? "checked " : ""}is working.`;
  }
  const names = unconfirmed.map((area) => `${area.title} (${area.word.toLowerCase()})`).join(", ");
  return `${head} Not confirmed working: ${names}.`;
}

function supportAreaLine(area: HealthArea): string {
  // Counts and states only: area.short can name a property or organisation.
  const safeShort = area.key === "ical" || area.key === "xero" ? "" : ` · ${area.short}`;
  return `- ${area.title}: ${area.word}${safeShort}`;
}

export function buildSupportText(view: Omit<SystemHealthView, "support">, facts: HealthFacts): string {
  const clock: Clock = { now: new Date(view.checkedAt), timeZone: view.timeZone };
  const lines: string[] = [
    `sNeek System health, checked ${formatInTimeZone(clock.now, clock.timeZone, "yyyy-MM-dd HH:mm")} (${clock.timeZone})`,
    `Worker: ${facts.worker.status === "ACTIVE" ? "reporting" : facts.worker.status.toLowerCase()}, last report ${facts.worker.lastSeenAt ? formatInTimeZone(new Date(facts.worker.lastSeenAt), clock.timeZone, "yyyy-MM-dd HH:mm") : "never"}`,
    `Needs attention: ${view.summary.needs}`,
    "Areas:",
    ...view.areas.map(supportAreaLine),
  ];
  const failing = (view.tasks ?? []).filter((row) => row.failure);
  if (failing.length) {
    lines.push("Failed scheduled tasks (latest run):");
    for (const row of failing) lines.push(`- ${row.name} (${row.plainName}): ${row.failure!.technical.replace(/\n/g, " | ")}`);
  }
  const late = (view.tasks ?? []).filter((row) => row.state === "attention");
  if (late.length) {
    lines.push("Late scheduled tasks:");
    for (const row of late) lines.push(`- ${row.name}: ${row.lastRunText}`);
  }
  if (view.queue) lines.push(`Queue: ${view.queue.waiting} waiting, ${view.queue.running} running, ${view.queue.willRetry} will retry, ${view.queue.failed24h} failed for good in 24 h, ${view.queue.stuck} stuck, ${view.queue.doneLastHour} done in the last hour`);
  else lines.push("Queue: not readable");
  lines.push(`Database: ${view.database.reachable ? `reachable, ${view.database.runningQueries ?? "?"} queries running, longest ${view.database.longestSeconds ?? "?"} s` : "not reachable"}`);
  lines.push(`Server (web process): up ${Math.floor(view.server.uptimeSeconds / 3600)} h, memory ${view.server.rssMB} MB of ${view.server.totalMemMB} MB`);
  return lines.map((line) => redactSupportText(line, 600)).join("\n");
}

/* ── Entry point ─────────────────────────────────────────────────────────── */

export function buildSystemHealthView(facts: HealthFacts): SystemHealthView {
  const clock: Clock = { now: new Date(facts.checkedAt), timeZone: facts.timeZone };
  const tasks = facts.tasks ? sortTaskRows(facts.tasks.map((row) => buildTaskRow(row, facts, clock))) : null;
  const areas: HealthArea[] = [
    scheduledArea(facts, tasks),
    queueArea(facts),
    databaseArea(facts),
    xeroArea(facts, clock),
    smsArea(facts, clock),
    emailArea(facts, clock),
    pushArea(facts, clock),
    storageArea(facts, clock),
    mapsArea(facts),
    aiArea(facts, clock),
    icalArea(facts, clock),
    paymentsArea(facts),
  ];
  const items = attentionItems(facts, areas, tasks, clock);
  const view: Omit<SystemHealthView, "support"> = {
    checkedAt: facts.checkedAt,
    timeZone: facts.timeZone,
    summary: { needs: items.length, sentence: summarySentence(items.length, areas.filter((area) => !items.some((item) => item.key === area.key))), items },
    areas,
    tasks,
    workerNote: workerNote(facts, clock),
    workerKnown: workerKnown(facts),
    queue: facts.queue,
    database: facts.database,
    server: facts.server,
    emailBounceList: facts.email.bounceList,
    uploadsUnresolved: facts.storage.unresolvedFailures,
  };
  return { ...view, support: buildSupportText(view, facts) };
}

/**
 * A check that could not be read: every area "Cannot tell from here", never
 * "Working". Used by the screen when "Check again" fails.
 */
export function unreadableAreas(areas: HealthArea[]): HealthArea[] {
  return areas.map((area) => ({ ...area, state: "unknown", word: HEALTH_STATE_WORD.unknown }));
}
