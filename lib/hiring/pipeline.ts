/**
 * Hiring pipeline: stages, stage moves and how a card is flagged (board
 * "Hiring", 2026-11-16). PLAIN module, safe for server pages and tests.
 *
 * Five stages (New, Screening, Interview, Offer, Hired) plus the closed ones
 * (Rejected, Withdrawn). Moving into Interview, Offer or Rejected opens that
 * stage's email preview first (Send, or Move without email); nothing is ever
 * sent by the move itself. Hired is never a plain move: it is the account
 * step ("Mark hired and invite"), which creates the account.
 */

export const PIPELINE_STAGES = ["NEW", "SCREENING", "INTERVIEW", "OFFER", "HIRED"] as const;
export const CLOSED_STAGES = ["REJECTED", "WITHDRAWN"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type ClosedStage = (typeof CLOSED_STAGES)[number];
export type ApplicationStage = PipelineStage | ClosedStage;

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  NEW: "New",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export function isApplicationStage(value: unknown): value is ApplicationStage {
  return typeof value === "string" && (value in STAGE_LABEL);
}

export function stageLabel(value: string): string {
  return isApplicationStage(value) ? STAGE_LABEL[value] : value;
}

/** Stages a plain move may go to (Hired is the account step). */
export const MOVE_TARGETS: readonly ApplicationStage[] = ["NEW", "SCREENING", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"];

/** The email template a move into this stage offers, or null when the stage has none. */
export function stageEmailTemplate(stage: string): "interview" | "offer" | "thank_you" | null {
  if (stage === "INTERVIEW") return "interview";
  if (stage === "OFFER") return "offer";
  if (stage === "REJECTED") return "thank_you";
  return null;
}

/** Why this move cannot be made, or null. Mirrors the server's rule. */
export function moveRefusal(from: string, to: string): string | null {
  if (from === to) return "The application is already in that stage.";
  if (to === "HIRED") return "Hiring creates an account. Use Mark hired and invite.";
  if (from === "HIRED") return "This person is hired and has an account. Change the account from their page instead.";
  if (!MOVE_TARGETS.includes(to as ApplicationStage)) return "Unknown stage.";
  return null;
}

export type CardTone = "attention" | "info" | "good" | null;

/** The facts a card is decided from (server-provided). */
export type CardFacts = {
  status: string;
  createdAt: string;
  testScore: number | null;
  testState: "none" | "sent" | "done";
  passMark: number | null;
  repliesReceived: number;
  lastReplyAt: string | null;
  lastEmailedAt: string | null;
  interviewDate: string | null;
  offerSentAt: string | null;
  hiredAccount: { signedIn: boolean; invitationPending: boolean; invitationExpiresAt: string | null } | null;
};

/** The title band and pill of a card: honey when the office owes a step, sky for a booked interview, sage once signed in. */
export function cardBand(facts: CardFacts, now: Date): { tone: CardTone; pill: string | null } {
  const ageDays = Math.floor((now.getTime() - new Date(facts.createdAt).getTime()) / 86_400_000);
  switch (facts.status) {
    case "NEW":
      return ageDays >= 3 ? { tone: "attention", pill: "First look" } : { tone: null, pill: null };
    case "SCREENING": {
      const replied = facts.lastReplyAt && (!facts.lastEmailedAt || facts.lastReplyAt > facts.lastEmailedAt);
      return replied ? { tone: "attention", pill: "Replied" } : { tone: null, pill: null };
    }
    case "INTERVIEW": {
      if (!facts.interviewDate) return { tone: null, pill: null };
      const at = new Date(facts.interviewDate);
      if (at.getTime() < now.getTime()) return { tone: "attention", pill: "Decide" };
      return { tone: "info", pill: "Booked" };
    }
    case "OFFER": {
      if (!facts.offerSentAt) return { tone: "attention", pill: "Offer not sent" };
      const waited = Math.floor((now.getTime() - new Date(facts.offerSentAt).getTime()) / 86_400_000);
      const replied = facts.lastReplyAt && facts.lastReplyAt > facts.offerSentAt;
      if (replied) return { tone: "attention", pill: "Replied" };
      return waited >= 2 ? { tone: "attention", pill: `No reply ${waited} d` } : { tone: null, pill: null };
    }
    case "HIRED": {
      if (!facts.hiredAccount) return { tone: null, pill: null };
      if (facts.hiredAccount.signedIn) return { tone: "good", pill: "Signed in" };
      if (facts.hiredAccount.invitationPending) return { tone: "attention", pill: "Invite not opened" };
      return { tone: null, pill: null };
    }
    default:
      return { tone: null, pill: null };
  }
}

/** The knowledge-test pill: always words, never colour alone. */
export function testPill(facts: Pick<CardFacts, "testScore" | "testState" | "passMark">): { text: string; tone: "ok" | "warn" | "bad" | "neutral" } {
  if (facts.testState === "done" && typeof facts.testScore === "number") {
    const score = Math.round(facts.testScore);
    const pass = facts.passMark ?? 70;
    return { text: `Test ${score}%`, tone: score >= pass ? "ok" : score >= pass - 10 ? "warn" : "bad" };
  }
  if (facts.testState === "sent") return { text: "Test sent, not done", tone: "neutral" };
  return { text: "No test", tone: "neutral" };
}

/** Interview scores: optional, internal only, 1 to 5. */
export const INTERVIEW_SCORE_KEYS = ["reliability", "detail", "communication"] as const;
export type InterviewScoreKey = (typeof INTERVIEW_SCORE_KEYS)[number];
export type InterviewScores = Partial<Record<InterviewScoreKey, number | null>>;
export const INTERVIEW_SCORE_LABEL: Record<InterviewScoreKey, string> = {
  reliability: "Reliability",
  detail: "Attention to detail",
  communication: "Communication",
};

export function parseInterviewScores(value: unknown): InterviewScores {
  const out: InterviewScores = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const key of INTERVIEW_SCORE_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 5) out[key] = n;
  }
  return out;
}

/** Decline reasons (board): a pick, plus Other with any text. */
export const DECLINE_REASONS = [
  { value: "availability", label: "Not enough availability" },
  { value: "area", label: "Outside our area" },
  { value: "test", label: "Test below pass mark" },
] as const;

/** Documents and learning a hire receives, as the confirm lists them. */
export function hireDocuments(kind: string): string[] {
  if (kind === "CLEANER") return ["Police check", "Driver licence", "White card / site card"];
  return ["Police check", "Driver licence"];
}
