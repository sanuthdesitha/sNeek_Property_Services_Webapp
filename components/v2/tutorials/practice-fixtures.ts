/**
 * Reads a practice screen answers in the browser (plain module). A server page
 * names the set by key; RegExp fixtures never cross the server/client boundary.
 */
import { PRACTICE_CLIENT, PRACTICE_PROPERTY } from "@/lib/tutorials/practice-samples";
import type { PracticeFixture } from "./practice-guard";

export type PracticeFixtureSet = "adminNewJob" | "cleanerJob" | "none";

const PRACTICE_CLEANERS = [
  { id: "practice-cleaner-jane", name: "Practice cleaner: Jane", email: "practice-jane@example.invalid", isActive: true },
  { id: "practice-cleaner-maria", name: "Practice cleaner: Maria", email: "practice-maria@example.invalid", isActive: true },
];

export const PRACTICE_FIXTURE_SETS: Record<PracticeFixtureSet, PracticeFixture[]> = {
  adminNewJob: [
    {
      match: /^\/api\/admin\/properties(\?|$)/,
      body: [{ id: PRACTICE_PROPERTY.id, name: PRACTICE_PROPERTY.name, suburb: PRACTICE_PROPERTY.suburb, accessInfo: { defaultCleanDurationHours: 3 }, assignedCleaningHours: 3 }],
    },
    { match: /^\/api\/admin\/clients(\?|$)/, body: [{ id: PRACTICE_CLIENT.id, name: PRACTICE_CLIENT.name }] },
    { match: /^\/api\/admin\/users\?role=CLEANER/, body: PRACTICE_CLEANERS },
    { match: /^\/api\/admin\/job-templates(\?|$)/, body: [] },
  ],
  // The practice job's side panels: nothing from the office for a sample job.
  cleanerJob: [
    { match: /^\/api\/cleaner\/urgent-stock\/asks\?jobId=practice-/, body: { asks: [] } },
    { match: /^\/api\/cleaner\/jobs\/practice-[^/]+\/(early-checkout-requests|reschedule-request)/, body: [] },
  ],
  none: [],
};
