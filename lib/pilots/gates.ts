import "server-only";
/**
 * The seams where pilot features choose between the new and the previous
 * behaviour. Each helper returns what the previous code path expects when
 * the pilot is off, so the old path runs unchanged.
 */
import { db } from "@/lib/db";
import { OPEN_RECTIFICATION_STATUSES } from "@/lib/quality/types";
import type { OpenQaIssueReminder, PropertyReminderSource } from "@/lib/properties/property-reminders";
import { confirmedReminderKeys, loadReminderCandidates, organisationTodayKey } from "@/lib/properties/reminders/load";
import { remindersForJob, unconfirmedRequired, type ReminderCandidate, type ReminderItem } from "@/lib/properties/reminders/model";
import { pilotApplies, type PilotState, type PilotSubject } from "./registry";
import { isPilotOn, loadPilotState } from "./state";

/** At most this many open QA issues are read out before a clean (newest first). */
export const OPEN_QA_ISSUES_BRIEFING_MAX = 5;

/**
 * Open QA issues at the property for the start briefing (pilot "Before-you-start
 * extras"): the issues whose fix is still owed, newest first. A failed read
 * gives none — the briefing never blocks on it — and is logged.
 */
async function loadOpenQaIssues(propertyId: string | null): Promise<OpenQaIssueReminder[]> {
  if (!propertyId) return [];
  try {
    const rows = await db.qaIssue.findMany({
      where: { propertyId, rectificationStatus: { in: [...OPEN_RECTIFICATION_STATUSES] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: OPEN_QA_ISSUES_BRIEFING_MAX,
      select: { id: true, category: true, description: true },
    });
    return rows.map((row) => ({ id: row.id, category: row.category, description: row.description }));
  } catch (error) {
    console.error("[pilots] open QA issues for the start briefing could not be read", error);
    return [];
  }
}

type BriefingDecision = { reminders: boolean; extras: boolean };

/** Smart reminders read for one property: candidates, or unavailable (logged; never shown as "none"). */
type SmartReminderRead = { candidates: ReminderCandidate[]; todayKey: string } | { unavailable: true };

async function readSmartReminders(propertyId: string | null): Promise<SmartReminderRead | null> {
  if (!propertyId) return null;
  try {
    const [candidates, todayKey] = await Promise.all([loadReminderCandidates(propertyId), organisationTodayKey()]);
    return { candidates, todayKey };
  } catch (error) {
    console.error("[pilots] property reminders could not be read", error);
    return { unavailable: true };
  }
}

function smartRemindersFor(read: SmartReminderRead | null, jobId: string | null, userId: string | null): { reminders?: ReminderItem[]; remindersUnavailable?: boolean } {
  if (!read) return {};
  if ("unavailable" in read) return { remindersUnavailable: true };
  return { reminders: remindersForJob(read.candidates, { jobId, userId, todayKey: read.todayKey }) };
}

function briefingSourceFor<T extends PropertyReminderSource>(
  property: T,
  decision: BriefingDecision,
  openQaIssues: OpenQaIssueReminder[],
  smart: { reminders?: ReminderItem[]; remindersUnavailable?: boolean } = {},
): PropertyReminderSource {
  if (!decision.reminders && !decision.extras) return null;
  return {
    features: decision.reminders ? property?.features : undefined,
    ...(decision.extras ? { openQaIssues } : {}),
    ...(decision.reminders ? smart : {}),
  };
}

/**
 * The property source for the start briefing, decided now for this cleaner
 * and property: "Property reminders" adds the property's facts (live plants)
 * and the smart reminders for this job and person (office-written and
 * automatic), "Before-you-start extras" adds the open QA issues at the
 * property. Both off → null, which gives exactly the briefing list from
 * before the pilots. `jobId` decides "next N jobs" reminders (a job that
 * already used one keeps it).
 */
export async function reminderSource<T extends PropertyReminderSource>(property: T, subject: PilotSubject, jobId: string | null = null): Promise<PropertyReminderSource> {
  const decision: BriefingDecision = {
    reminders: await isPilotOn("property-reminders", subject),
    extras: await isPilotOn("before-start-extras", subject),
  };
  const openQaIssues = decision.extras ? await loadOpenQaIssues(subject.propertyId ?? null) : [];
  const smart = decision.reminders ? smartRemindersFor(await readSmartReminders(subject.propertyId ?? null), jobId, subject.userId ?? null) : {};
  return briefingSourceFor(property, decision, openQaIssues, smart);
}

/** The same choice for several people at once (the office's briefing proof), from one state read. */
export async function reminderSourceByUser<T extends PropertyReminderSource>(
  property: T,
  propertyId: string | null,
  jobId: string | null = null,
): Promise<(userId: string | null) => PropertyReminderSource> {
  const state: PilotState = await loadPilotState();
  const extrasSetting = state.pilots["before-start-extras"];
  const extrasMayApply = state.readable && extrasSetting.mode !== "OFF";
  const openQaIssues = extrasMayApply ? await loadOpenQaIssues(propertyId) : [];
  const remindersMayApply = state.readable && state.pilots["property-reminders"].mode !== "OFF";
  const smartRead = remindersMayApply ? await readSmartReminders(propertyId) : null;
  return (userId) =>
    briefingSourceFor(
      property,
      {
        reminders: pilotApplies(state, "property-reminders", { userId, propertyId }),
        extras: pilotApplies(state, "before-start-extras", { userId, propertyId }),
      },
      openQaIssues,
      smartRemindersFor(smartRead, jobId, userId),
    );
}

/** "Looks unused — ask the office" offered and accepted for this cleaner / property. */
export async function unusedCheckEnabled(subject: PilotSubject): Promise<boolean> {
  return isPilotOn("unused-check", subject);
}

type JobStartReader = { timeLog: { findFirst: (args: { where: { jobId: string }; orderBy: { startedAt: "asc" }; select: { startedAt: true } }) => Promise<{ startedAt: Date } | null> } };

/** Who, where and which job a "New cleaner job flow" decision is for. */
export type CleanerJobFlowSubject = { jobId: string; userId: string; propertyId: string | null };

/**
 * "New cleaner job flow" (arrival video lock, room by room, submit blocker
 * with office override, hold while "Looks unused" is open) for this cleaner,
 * property and job, decided now. A job whose first clock-in (anyone's) came
 * before the pilot was switched on — or its scope last changed — keeps the
 * previous flow to the end, so switching on mid-job never blocks it. The time
 * log is read only when the pilot is not Off.
 */
export async function cleanerJobFlowOn(database: JobStartReader, subject: CleanerJobFlowSubject): Promise<boolean> {
  const state = await loadPilotState();
  if (!pilotApplies(state, "cleaner-job-flow", { userId: subject.userId, propertyId: subject.propertyId })) return false;
  const first = await database.timeLog.findFirst({ where: { jobId: subject.jobId }, orderBy: { startedAt: "asc" }, select: { startedAt: true } });
  return pilotApplies(state, "cleaner-job-flow", { userId: subject.userId, propertyId: subject.propertyId, jobStartedAt: first?.startedAt ?? null });
}

/**
 * Must-confirm "before leaving" reminders this cleaner has not confirmed on
 * this job (pilot "Property reminders", decided at the time of the submit).
 * Pilot off → none. A failed read is logged and gives none: a submit is never
 * held by a read that could not be made.
 */
export async function unconfirmedLeavingReminders<T extends PropertyReminderSource>(property: T, subject: PilotSubject, jobId: string): Promise<ReminderItem[]> {
  try {
    const source = await reminderSource(property, subject, jobId);
    const required = (source?.reminders ?? []).filter((item) => item.moment === "BEFORE_LEAVING" && item.mustConfirm);
    if (required.length === 0 || !subject.userId) return [];
    const confirmed = await confirmedReminderKeys(jobId, subject.userId);
    return unconfirmedRequired(required, confirmed);
  } catch (error) {
    console.error("[pilots] before-leaving reminders could not be checked", error);
    return [];
  }
}
