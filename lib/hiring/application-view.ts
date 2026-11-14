import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { accountKindLabel, HIRE_ACCOUNT_KINDS, hireRefusal, type HireAccountKind } from "@/lib/accounts/create-account-rules";
import type { ResolvedAccountCreator } from "@/lib/accounts/account-creator";
import { getHiringApplicationDetail } from "@/lib/workforce/service";
import { loadHirePreview, type HirePreview } from "./hire";
import { parseInterviewScores, PIPELINE_STAGES, stageLabel, type InterviewScores } from "./pipeline";

/**
 * The Hiring application page's read model (boards "Hiring application" and
 * "Hiring on a phone", 2026-11-16), worded on the server in the organisation
 * timezone: stage strip, five facts, answers as submitted, documents, the
 * knowledge test by category with free-text answers to mark, interview notes
 * and internal scores, history, the offer, the hired account's state and
 * exactly what "Mark hired and invite" will create.
 */

export type StageStep = { key: string; label: string; state: "done" | "current" | "todo"; note: string };
export type Fact = { label: string; value: string; note: string };
export type AnswerSection = { title: string; rows: Array<{ label: string; value: string }> };
export type TestCategory = { label: string; earned: number; possible: number; score: number };
export type FreeTextAnswer = { id: string; prompt: string; answer: string; verdict: "right" | "wrong" | null };
export type HistoryRow = { id: string; at: string; summary: string; from: string | null; to: string | null; body: string | null };
export type OfferView = { roleTitle: string; rate: string; startDate: string; accountRole: string };
export type HiredView = {
  userId: string;
  name: string | null;
  kindLabel: string;
  createdLabel: string;
  signedIn: boolean;
  invitation: { pending: boolean; expiresLabel: string | null; revoked: boolean } | null;
  email: { state: string; error: string | null; atLabel: string | null } | null;
};

export type ApplicationView = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  stageLabel: string;
  positionTitle: string;
  positionHireRole: HireAccountKind | null;
  intro: string;
  stages: StageStep[];
  facts: Fact[];
  answers: AnswerSection[];
  answerCount: number;
  resume: { url: string; name: string } | null;
  coverLetter: string | null;
  test: { label: string; score: number; passMark: number; categories: TestCategory[]; freeText: FreeTextAnswer[] } | null;
  quizzes: unknown[];
  interview: { dateInput: string; label: string; notes: string; scores: InterviewScores };
  history: HistoryRow[];
  offer: OfferView;
  hired: HiredView | null;
  preview: HirePreview;
  hireKinds: Array<{ kind: HireAccountKind; label: string; refusal: string | null }>;
  timeZone: string;
};

const HIDDEN_KEYS = new Set(["fullName", "email", "phone", "resumeUrl", "resumeKey", "coverLetter"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function humanKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function answerSections(schema: unknown, answers: Record<string, unknown>): AnswerSection[] {
  const steps = Array.isArray(record(schema).steps) ? (record(schema).steps as unknown[]) : [];
  const used = new Set<string>();
  const sections: AnswerSection[] = [];
  for (const raw of steps) {
    const step = record(raw);
    const fields = Array.isArray(step.fields) ? (step.fields as unknown[]) : [];
    const rows = fields
      .map((field) => record(field))
      .filter((field) => typeof field.id === "string" && !HIDDEN_KEYS.has(String(field.id)))
      .map((field) => {
        used.add(String(field.id));
        const value = text(answers[String(field.id)]);
        return { label: String(field.label ?? humanKey(String(field.id))), value: value || "Not answered" };
      });
    if (rows.length) sections.push({ title: String(step.title ?? "Answers"), rows });
  }
  const extra = Object.entries(answers)
    .filter(([key, value]) => !used.has(key) && !HIDDEN_KEYS.has(key) && text(value))
    .map(([key, value]) => ({ label: humanKey(key), value: text(value) }));
  if (extra.length) sections.push({ title: "Other answers", rows: extra });
  return sections;
}

function stageSteps(status: string, events: Array<{ type: string; createdAt: Date; data: unknown }>, notes: Record<string, string>): StageStep[] {
  const index = (PIPELINE_STAGES as readonly string[]).indexOf(status);
  return PIPELINE_STAGES.map((stage, position) => {
    const state: StageStep["state"] = index < 0 ? (position === 0 ? "done" : "todo") : position < index ? "done" : position === index ? (stage === "HIRED" ? "done" : "current") : "todo";
    const reached = events.find((event) => event.type === "STATUS_CHANGE" && record(event.data).to === stage);
    return { key: stage, label: stage === "NEW" ? "Applied" : stageLabel(stage), state, note: notes[stage] ?? (state === "todo" ? "Not yet" : reached ? "" : "") };
  });
}

export async function loadApplicationView(applicationId: string, creator: ResolvedAccountCreator, timeZone: string, now = new Date()): Promise<ApplicationView | null> {
  const application = await getHiringApplicationDetail(applicationId);
  if (!application) return null;
  const [preview, hiredExtra] = await Promise.all([
    loadHirePreview(applicationId, creator),
    application.hiredUserId
      ? db.user.findUnique({
          where: { id: application.hiredUserId },
          select: { createdAt: true, lastSeenAt: true, invitation: { select: { acceptedAt: true, expiresAt: true, revokedAt: true } } },
        })
      : Promise.resolve(null),
  ]);
  const lastEmail = application.hiredUserId
    ? await db.auditLog.findFirst({ where: { action: "ACCOUNT_EMAIL_SENT", entity: "User", entityId: application.hiredUserId }, orderBy: { createdAt: "desc" }, select: { after: true, createdAt: true } })
    : null;

  const day = (date: Date) => formatInTimeZone(date, timeZone, "EEE d MMM");
  const stamp = (date: Date) => formatInTimeZone(date, timeZone, "EEE d MMM HH:mm");
  const answers = record(application.answers);
  const evaluation = record(application.evaluation);
  const assessment = record(evaluation.assessment);
  const freeReview = record(evaluation.freeTextReview);
  const offer = record(application.offerDetails);
  const passMark = Number(assessment.passThreshold ?? record(application.position.screeningSchema).passThreshold ?? 70) || 70;
  const flagged = Array.isArray(assessment.flagged) ? (assessment.flagged as unknown[]).map(record) : [];
  const freeText: FreeTextAnswer[] = flagged.map((row) => {
    const verdict = record(freeReview[String(row.id)]).verdict;
    return { id: String(row.id), prompt: String(row.prompt ?? ""), answer: String(row.answer ?? ""), verdict: verdict === "right" || verdict === "wrong" ? verdict : null };
  });
  const toReview = freeText.filter((row) => row.verdict === null).length;
  const score = typeof assessment.score === "number" ? assessment.score : typeof application.screeningScore === "number" ? application.screeningScore : null;
  const test = typeof assessment.score === "number"
    ? {
        label: `${assessment.totalQuestions ?? "?"} questions`,
        score: Math.round(assessment.score as number),
        passMark,
        categories: (Array.isArray(assessment.categoryScores) ? (assessment.categoryScores as unknown[]) : []).map(record).map((row) => ({
          label: String(row.label ?? row.category ?? "Category"),
          earned: Number(row.earned ?? 0),
          possible: Number(row.possible ?? 0),
          score: Number(row.score ?? 0),
        })),
        freeText,
      }
    : null;

  const events = application.events;
  const interviewEvent = events.find((event) => event.type === "STATUS_CHANGE" && record(event.data).to === "INTERVIEW");
  const screeningEvent = events.find((event) => event.type === "STATUS_CHANGE" && record(event.data).to === "SCREENING");
  const notes: Record<string, string> = {
    NEW: stamp(application.createdAt),
    SCREENING: score !== null ? `Test ${Math.round(score)}%${screeningEvent ? `, ${day(screeningEvent.createdAt)}` : ""}` : screeningEvent ? day(screeningEvent.createdAt) : "",
    INTERVIEW: application.interviewDate ? (application.interviewDate < now ? `Done ${day(application.interviewDate)} · decide` : `Booked ${stamp(application.interviewDate)}`) : interviewEvent ? `Since ${day(interviewEvent.createdAt)}` : "",
    OFFER: typeof offer.sentAt === "string" ? `Sent ${day(new Date(offer.sentAt))}` : application.status === "OFFER" ? "Email not sent yet" : "",
    HIRED: hiredExtra ? `Account ${day(hiredExtra.createdAt)}` : "",
  };

  const emailsNote = application.lastReplyAt ? `last reply ${day(application.lastReplyAt)}` : application.lastEmailedAt ? `last sent ${day(application.lastEmailedAt)}` : "none yet";
  const days = text(answers.availabilityDays);
  const facts: Fact[] = [
    { label: "Knowledge test", value: score !== null ? `${Math.round(score)}%` : "Not done", note: score !== null ? `pass mark ${passMark}%${toReview ? ` · ${toReview} answer${toReview === 1 ? "" : "s"} to review` : ""}` : "no score recorded" },
    { label: "Emails", value: `${application.emailsSent} sent · ${application.repliesReceived} repl${application.repliesReceived === 1 ? "y" : "ies"}`, note: emailsNote },
    { label: "Can work", value: days || "Not answered", note: days ? "as answered" : "" },
    { label: "Car and licence", value: text(answers.hasCar) || "Not answered", note: "as answered" },
    { label: "Right to work", value: text(answers.rightToWork) || "Not answered", note: "as answered, not checked" },
  ];

  const interviewScores = parseInterviewScores(evaluation.interviewScores);
  const hired: HiredView | null = application.hiredUser && hiredExtra
    ? {
        userId: application.hiredUser.id,
        name: application.hiredUser.name,
        kindLabel: accountKindLabel(application.hiredUser.role),
        createdLabel: stamp(hiredExtra.createdAt),
        signedIn: Boolean(hiredExtra.invitation?.acceptedAt || (!hiredExtra.invitation && hiredExtra.lastSeenAt)),
        invitation: hiredExtra.invitation
          ? { pending: !hiredExtra.invitation.acceptedAt && !hiredExtra.invitation.revokedAt && hiredExtra.invitation.expiresAt > now, expiresLabel: day(hiredExtra.invitation.expiresAt), revoked: Boolean(hiredExtra.invitation.revokedAt) }
          : null,
        email: lastEmail ? { state: String(record(lastEmail.after).state ?? "NOT_RECORDED"), error: typeof record(lastEmail.after).error === "string" ? String(record(lastEmail.after).error) : null, atLabel: formatInTimeZone(lastEmail.createdAt, timeZone, "HH:mm") } : null,
      }
    : null;

  const resumeUrl = application.resumeUrl;
  const sections = answerSections(application.position.applicationSchema, answers);
  return {
    id: application.id,
    name: application.fullName,
    email: application.email,
    phone: application.phone,
    status: application.status,
    stageLabel: stageLabel(application.status),
    positionTitle: application.position.title,
    positionHireRole: (HIRE_ACCOUNT_KINDS as readonly string[]).includes(String(application.position.hireAccountRole)) ? (application.position.hireAccountRole as HireAccountKind) : null,
    intro: [application.position.title, `applied ${day(application.createdAt)}`, application.email, application.phone, text(answers.suburb)].filter(Boolean).join(" · "),
    stages: stageSteps(application.status, events, notes),
    facts,
    answers: sections,
    answerCount: sections.reduce((sum, section) => sum + section.rows.length, 0),
    resume: resumeUrl ? { url: resumeUrl, name: decodeURIComponent(resumeUrl.split("/").pop()?.split("?")[0] ?? "Resume") } : null,
    coverLetter: application.coverLetter,
    test,
    quizzes: JSON.parse(JSON.stringify(application.quizAssignments)) as unknown[],
    interview: {
      dateInput: application.interviewDate ? formatInTimeZone(application.interviewDate, timeZone, "yyyy-MM-dd'T'HH:mm") : "",
      label: application.interviewDate ? stamp(application.interviewDate) : "Not booked",
      notes: application.interviewNotes ?? "",
      scores: interviewScores,
    },
    history: events.map((event) => {
      const data = record(event.data);
      return {
        id: event.id,
        at: stamp(event.createdAt),
        summary: `${event.summary}${event.actor?.name ? ` · ${event.actor.name}` : ""}`,
        from: typeof data.from === "string" ? stageLabel(data.from) : null,
        to: typeof data.to === "string" ? stageLabel(data.to) : null,
        body: event.type === "EMAIL_REPLY" && typeof data.body === "string" ? data.body : null,
      };
    }),
    offer: {
      roleTitle: typeof offer.roleTitle === "string" ? offer.roleTitle : application.position.title,
      rate: typeof offer.rate === "string" ? offer.rate : "",
      startDate: typeof offer.startDate === "string" ? offer.startDate : "",
      accountRole: typeof offer.accountRole === "string" ? offer.accountRole : application.position.hireAccountRole ?? "",
    },
    hired,
    preview,
    hireKinds: HIRE_ACCOUNT_KINDS.map((kind) => ({ kind, label: accountKindLabel(kind), refusal: hireRefusal(creator, kind) })),
    timeZone,
  };
}
