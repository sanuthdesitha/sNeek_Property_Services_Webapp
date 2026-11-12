import "server-only";
/**
 * The monthly Insights email (owner decision 2026-11-11, second set item 6).
 *
 * - Content: the previous month's Business summary from the EXISTING Insights
 *   service (`getBusinessInsights`), built per recipient with that
 *   recipient's own finance access, so a recipient without finance access gets
 *   no financial figures (./monthly-email-content).
 * - Recipients: chosen in Settings from active ADMIN accounts and active
 *   OPS_MANAGER accounts with Insights (reports) access; no free-text address.
 *   Re-checked here at send time; anyone no longer eligible is skipped and
 *   recorded.
 * - Transport: EMAIL only, chosen explicitly, through the office notification
 *   pipeline (`sendOfficeNotification`, STAFF_MEMBER scope re-checked at
 *   dispatch). While the pipeline's EMAIL transport is off in this
 *   environment, that function uses the documented direct fallback through the
 *   email chokepoint and records it; a transport switched off in the
 *   notifications area is not sent ("switched off"), never silently dropped.
 * - Once per month: a settings row "insightsMonthlyEmailSent:YYYY-MM" is
 *   created BEFORE sending; a second worker or a restart finds it and does not
 *   send again. Its value records each recipient's truthful state. A crash
 *   mid-send leaves the row "sending" (at most once, never twice).
 */
import { randomUUID } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppBaseUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { insightsAccessFor } from "./access";
import { getBusinessInsights, type BusinessPayload } from "./business";
import { buildInsightsEmail } from "./monthly-email-content";
import {
  INSIGHTS_EMAIL_SENT_PREFIX,
  INSIGHTS_EMAIL_SETTING_KEY,
  insightsEmailDue,
  sanitizeInsightsEmailSettings,
  type InsightsEmailSettings,
} from "./monthly-email-settings";
import { resolveInsightsPeriod, type InsightsPeriod } from "./period";
import type { InsightsAccess } from "./types";

export const INSIGHTS_EMAIL_TYPE_KEY = "insights.monthly_email";
const FALLBACK_TZ = "Australia/Sydney";

export type EligibleRecipient = { id: string; name: string | null; email: string | null; role: Role; finance: boolean };

export async function readInsightsEmailSettings(): Promise<InsightsEmailSettings> {
  const row = await db.appSetting.findUnique({ where: { key: INSIGHTS_EMAIL_SETTING_KEY } });
  return sanitizeInsightsEmailSettings(row?.value);
}

/** Active administrators, and active operations managers whose packs open Insights. */
export async function listEligibleRecipients(): Promise<EligibleRecipient[]> {
  const users = await db.user.findMany({
    where: { isActive: true, role: { in: [Role.ADMIN, Role.OPS_MANAGER] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
  const eligible: EligibleRecipient[] = [];
  for (const user of users) {
    const levels = await getOpsAccess(user);
    if (levels && !canUseOpsPath(levels, "/v2/admin/reports")) continue;
    eligible.push({ ...user, finance: insightsAccessFor(levels).finance });
  }
  return eligible;
}

/** Validate and store; only eligible people can be chosen. Audited. */
export async function saveInsightsEmailSettings(input: unknown, actorId: string): Promise<InsightsEmailSettings> {
  const next = sanitizeInsightsEmailSettings(input);
  const eligible = new Set((await listEligibleRecipients()).map((recipient) => recipient.id));
  const refused = next.recipientIds.filter((id) => !eligible.has(id));
  if (refused.length) throw new Error("Choose recipients from the list: administrators, or operations managers with Insights access.");
  const value = next as unknown as Prisma.InputJsonValue;
  await db.$transaction([
    db.appSetting.upsert({ where: { key: INSIGHTS_EMAIL_SETTING_KEY }, create: { key: INSIGHTS_EMAIL_SETTING_KEY, value }, update: { value } }),
    db.auditLog.create({ data: { userId: actorId, action: "INSIGHTS_MONTHLY_EMAIL_SETTINGS_UPDATED", entity: "AppSetting", entityId: INSIGHTS_EMAIL_SETTING_KEY, after: value } }),
  ]);
  return next;
}

function monthLabel(period: InsightsPeriod, test: boolean): string {
  const [year, month] = period.fromKey.split("-").map(Number);
  const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
  return test ? `${name} so far` : name;
}

type SendPlan = {
  period: InsightsPeriod;
  recipients: EligibleRecipient[];
  eventId: string;
  actorId: string | null;
  settings: InsightsEmailSettings;
  test: boolean;
  now: Date;
};

/** One payload per finance level, each from the Insights service itself. */
async function payloadsFor(plan: SendPlan): Promise<Map<boolean, BusinessPayload>> {
  const payloads = new Map<boolean, BusinessPayload>();
  for (const finance of Array.from(new Set(plan.recipients.map((recipient) => recipient.finance)))) {
    const access: InsightsAccess = { finance };
    payloads.set(finance, await getBusinessInsights(plan.period, { clientId: "" }, access, plan.now));
  }
  return payloads;
}

async function sendPlan(plan: SendPlan): Promise<RecipientOutcome[]> {
  if (plan.recipients.length === 0) return [];
  const [payloads, settings, controls] = await Promise.all([payloadsFor(plan), getAppSettings(), getNotificationTypeControls()]);
  const insightsUrl = `${getAppBaseUrl() ?? ""}/v2/admin/reports?tab=business&period=${plan.test ? "this-month" : "last-month"}`;
  const byId = new Map(plan.recipients.map((recipient) => [recipient.id, recipient]));
  const contentFor = (recipient: OfficeRecipient) => {
    const eligible = byId.get(recipient.id)!;
    const content = buildInsightsEmail({
      payload: payloads.get(eligible.finance)!,
      sections: plan.settings.sections,
      recipientName: recipient.name,
      companyName: settings.companyName || "sNeek",
      insightsUrl,
      periodLabel: monthLabel(plan.period, plan.test),
      test: plan.test,
    });
    return { subject: content.subject, html: content.html };
  };
  const first = contentFor(plan.recipients[0]);
  return sendOfficeNotification({
    typeKey: INSIGHTS_EMAIL_TYPE_KEY,
    eventKey: INSIGHTS_EMAIL_TYPE_KEY,
    eventId: plan.eventId,
    entity: { type: "InsightsMonthlyEmail", id: plan.period.fromKey.slice(0, 7) },
    actorId: plan.actorId,
    scopeType: "STAFF_MEMBER",
    scopeId: (recipient) => recipient.id,
    category: "reports",
    severity: "INFO",
    jobId: null,
    subject: first.subject,
    body: `Business summary for ${monthLabel(plan.period, plan.test)}.`,
    email: contentFor,
    emailKind: "insights_monthly",
    // EMAIL only, chosen explicitly: no inbox row, phone push or browser push.
    transports: ["EMAIL"],
    recipients: plan.recipients.map((recipient) => ({ id: recipient.id, role: recipient.role, name: recipient.name, email: recipient.email })),
    respectsPreferences: false,
    disabledTransports: controls.disabledTransports[INSIGHTS_EMAIL_TYPE_KEY] ?? [],
  });
}

export type MonthlyRunResult =
  | { status: "skipped"; reason: string }
  | { status: "already-sent"; month: string }
  | { status: "sent"; month: string; outcomes: RecipientOutcome[]; skippedRecipients: string[] };

function outcomeRecord(outcome: RecipientOutcome) {
  return { userId: outcome.userId, transport: outcome.transport, path: outcome.path, state: outcome.state, errorCode: outcome.errorCode ?? null };
}

/** The scheduled job: the previous month's summary, at most once per month. */
export async function runMonthlyInsightsEmail(now: Date = new Date()): Promise<MonthlyRunResult> {
  const [settings, appSettings] = await Promise.all([readInsightsEmailSettings(), getAppSettings()]);
  const due = insightsEmailDue(settings, now, appSettings.timezone || FALLBACK_TZ);
  if (!due.due) return { status: "skipped", reason: due.reason };
  const markerKey = `${INSIGHTS_EMAIL_SENT_PREFIX}${due.reportMonth}`;
  try {
    await db.appSetting.create({ data: { key: markerKey, value: { state: "sending", startedAt: now.toISOString() } } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "already-sent", month: due.reportMonth };
    throw error;
  }
  const eligible = await listEligibleRecipients();
  const recipients = eligible.filter((recipient) => settings.recipientIds.includes(recipient.id));
  const skippedRecipients = settings.recipientIds.filter((id) => !recipients.some((recipient) => recipient.id === id));
  // "last-month" relative to the send day is the report month.
  const period = resolveInsightsPeriod({ period: "last-month" }, now);
  let outcomes: RecipientOutcome[] = [];
  let failure: string | null = null;
  try {
    outcomes = await sendPlan({ period, recipients, eventId: `insights-monthly:${due.reportMonth}`, actorId: null, settings, test: false, now });
  } catch (error) {
    failure = error instanceof Error ? error.message : "The email could not be built or sent.";
  }
  await db.appSetting.update({
    where: { key: markerKey },
    data: { value: {
      state: failure ? "failed" : "done",
      startedAt: now.toISOString(),
      finishedAt: new Date().toISOString(),
      period: { fromKey: period.fromKey, toKey: period.toKey },
      outcomes: outcomes.map(outcomeRecord),
      skippedRecipients: skippedRecipients.map((id) => ({ id, reason: "No longer an administrator or an operations manager with Insights access." })),
      ...(failure ? { error: failure } : {}),
      deliveryConfirmed: false,
    } as Prisma.InputJsonValue },
  });
  if (failure) throw new Error(`Monthly Insights email failed: ${failure}`);
  return { status: "sent", month: due.reportMonth, outcomes, skippedRecipients };
}

/** "Send me this month's so far": the signed-in administrator only; no marker. */
export async function sendInsightsEmailTest(actor: { id: string }, now: Date = new Date()): Promise<RecipientOutcome[]> {
  const eligible = (await listEligibleRecipients()).find((recipient) => recipient.id === actor.id);
  if (!eligible) throw new Error("Only an administrator, or an operations manager with Insights access, can receive this email.");
  const settings = await readInsightsEmailSettings();
  const period = resolveInsightsPeriod({ period: "this-month" }, now);
  const outcomes = await sendPlan({ period, recipients: [eligible], eventId: `insights-monthly-test:${actor.id}:${randomUUID()}`, actorId: actor.id, settings, test: true, now });
  await db.auditLog.create({ data: {
    userId: actor.id, action: "INSIGHTS_MONTHLY_EMAIL_TEST_SENT", entity: "AppSetting", entityId: INSIGHTS_EMAIL_SETTING_KEY,
    after: { outcomes: outcomes.map(outcomeRecord), deliveryConfirmed: false } as Prisma.InputJsonValue,
  } });
  return outcomes;
}

/** The last months' markers, newest first, for the settings screen. */
export async function readInsightsEmailLog(limit = 6): Promise<Array<{ month: string; value: unknown; updatedAt: string }>> {
  const rows = await db.appSetting.findMany({
    where: { key: { startsWith: INSIGHTS_EMAIL_SENT_PREFIX } },
    orderBy: { key: "desc" },
    take: limit,
    select: { key: true, value: true, updatedAt: true },
  });
  return rows.map((row) => ({ month: row.key.slice(INSIGHTS_EMAIL_SENT_PREFIX.length), value: row.value, updatedAt: row.updatedAt.toISOString() }));
}
