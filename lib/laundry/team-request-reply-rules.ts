/**
 * How a laundry partner's team answers an "Ask laundry team" request in the
 * laundry portal ("From the office"). PURE and PLAIN (no "use client"): shared
 * by the reply service, the portal inbox, the office run panel and tests.
 *
 * An answer is either the run's own existing action (confirm the pickup or
 * drop-off at the stop, add the drop-off photo: the request then clears by
 * itself because the run no longer calls for it), or a typed reply stored in
 * LaundryTeamRequestReply:
 *   CONFIRMED  "Yes" to a pickup / drop-off time, optionally with the time;
 *   CANNOT     "Can't" with a reason;
 *   RETURN_AT  "When will it be back?" answered with a day and time;
 *   MESSAGE    a note to the office (does not clear the request).
 * A typed reply records what the team said. It never changes the run.
 */
import type { LaundryTeamRequestKind } from "./nudge-rules";

export type TeamReplyAnswer = "CONFIRMED" | "CANNOT" | "RETURN_AT" | "MESSAGE";

export const TEAM_REPLY_ANSWERS: readonly TeamReplyAnswer[] = ["CONFIRMED", "CANNOT", "RETURN_AT", "MESSAGE"];

/** Typed answers each request kind accepts (MESSAGE is always accepted). */
export const ANSWERS_BY_KIND: Record<LaundryTeamRequestKind, readonly TeamReplyAnswer[]> = {
  TEAM_CONFIRM_PICKUP: ["CONFIRMED", "CANNOT", "MESSAGE"],
  TEAM_MOVE_PICKUP: ["CONFIRMED", "CANNOT", "MESSAGE"],
  TEAM_CONFIRM_DROP: ["CONFIRMED", "CANNOT", "MESSAGE"],
  TEAM_RETURN_ETA: ["RETURN_AT", "MESSAGE"],
  TEAM_PHOTO: ["CANNOT", "MESSAGE"],
};

/** A typed answer that settles the request (the inbox moves it to Answered). */
export function answerClearsRequest(answer: TeamReplyAnswer): boolean {
  return answer !== "MESSAGE";
}

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type TeamReplyInput = {
  answer: TeamReplyAnswer;
  time?: string | null;
  date?: string | null;
  note?: string | null;
};

/** Null when the answer is acceptable for the request kind, otherwise why not. */
export function teamReplyProblem(kind: LaundryTeamRequestKind, input: TeamReplyInput, todayKey: string): string | null {
  if (!ANSWERS_BY_KIND[kind].includes(input.answer)) return "That answer does not fit this request.";
  const note = input.note?.trim() ?? "";
  if (input.time && !TIME_PATTERN.test(input.time)) return "Give the time as HH:mm.";
  if (input.date && (!DATE_PATTERN.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`)))) return "Give the day as a date.";
  if (input.answer === "RETURN_AT") {
    if (!input.date) return "Say which day it will be back.";
    if (input.date < todayKey) return "The return day cannot be in the past.";
  }
  if (input.answer === "CANNOT" && note.length < 3) return "Say briefly why not, so the office can plan.";
  if (input.answer === "MESSAGE" && note.length < 2) return "Write the message for the office.";
  if (note.length > 1000) return "Keep the note under 1,000 characters.";
  return null;
}

export const ANSWER_LABELS: Record<TeamReplyAnswer, string> = {
  CONFIRMED: "Confirmed",
  CANNOT: "Can't",
  RETURN_AT: "Back by",
  MESSAGE: "Message",
};

export type TeamReplySummary = {
  id: string;
  requestKind: string;
  answer: TeamReplyAnswer;
  time: string | null;
  /** YYYY-MM-DD, a calendar day. */
  date: string | null;
  note: string | null;
  byName: string;
  /** ISO instant. */
  at: string;
};

/** "Back by Fri 13 Nov 14:00" style text, from stored values only. */
export function describeTeamReply(reply: Pick<TeamReplySummary, "answer" | "time" | "date" | "note">, formatDay: (key: string) => string): string {
  const when = [reply.date ? formatDay(reply.date) : null, reply.time].filter(Boolean).join(" ");
  const head = reply.answer === "CONFIRMED" ? `Yes${when ? `, ${when}` : ""}` : reply.answer === "RETURN_AT" ? `Back by ${when}` : reply.answer === "CANNOT" ? "Can't" : "Message";
  return reply.note ? `${head}: ${reply.note}` : head;
}

export function isTeamReplyAnswer(value: unknown): value is TeamReplyAnswer {
  return typeof value === "string" && (TEAM_REPLY_ANSWERS as readonly string[]).includes(value);
}
