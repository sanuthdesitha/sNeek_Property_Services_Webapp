import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { parseScreeningSchema } from "@/lib/workforce/assessment";
import { accountKindLabel, hiresBecomeLabel } from "@/lib/accounts/create-account-rules";
import { cardBand, CLOSED_STAGES, testPill, type CardFacts, type CardTone } from "./pipeline";

/**
 * The Hiring hub's read model (board "Hiring", 2026-11-16): one card per
 * application with its band, pill and lines already worded in the
 * organisation timezone, the five figures, and the roles table. Figures are
 * counted from the rows read here; when the read is capped the figure says so.
 */

export type HubCard = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  positionId: string;
  positionTitle: string;
  /** "Estate Cleaner · 4 d ago" or "Cleaner account · 2 Nov". */
  subtitle: string;
  tone: CardTone;
  pill: string | null;
  test: { text: string; tone: "ok" | "warn" | "bad" | "neutral" } | null;
  /** The card's last line ("2 emails · 1 reply", "Interview Thu 19 Nov"). */
  detail: string;
  testScore: number | null;
  testPassed: boolean | null;
  testDone: boolean;
};

export type HubRole = {
  id: string;
  title: string;
  slug: string;
  subtitle: string;
  isPublished: boolean;
  applications: number;
  open: number;
  test: string;
  hiresBecome: string;
  hiresBecomeSet: boolean;
};

export type HubFigure = { label: string; value: string; note: string };

export type HiringHub = { cards: HubCard[]; roles: HubRole[]; figures: HubFigure[]; closedCounts: { rejected: number; withdrawn: number }; capped: boolean };

const READ_LIMIT = 300;
const DAY = 86_400_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function relativeDays(from: Date, now: Date): string {
  const days = Math.floor((now.getTime() - from.getTime()) / DAY);
  return days <= 0 ? "today" : `${days} d ago`;
}

function passMarkOf(schema: unknown): number | null {
  const value = Number(record(schema).passThreshold);
  return Number.isFinite(value) ? value : null;
}

export async function loadHiringHub(timeZone: string, now = new Date()): Promise<HiringHub> {
  const [positions, applications] = await Promise.all([
    db.hiringPosition.findMany({
      orderBy: [{ isPublished: "desc" }, { updatedAt: "desc" }],
      select: { id: true, title: true, slug: true, isPublished: true, employmentType: true, location: true, screeningSchema: true, hireAccountRole: true, _count: { select: { applications: true } } },
    }),
    db.hiringApplication.findMany({
      orderBy: { createdAt: "desc" },
      take: READ_LIMIT,
      select: {
        id: true, fullName: true, email: true, phone: true, status: true, positionId: true, createdAt: true, screeningScore: true,
        emailsSent: true, repliesReceived: true, lastEmailedAt: true, lastReplyAt: true, interviewDate: true, offerDetails: true,
        position: { select: { title: true } },
        quizAssignments: { select: { status: true, score: true } },
        hiredUser: {
          select: {
            role: true, createdAt: true, lastSeenAt: true,
            invitation: { select: { acceptedAt: true, expiresAt: true, revokedAt: true } },
            requestedStaffDocuments: { select: { status: true } },
          },
        },
      },
    }),
  ]);
  const passMarks = new Map(positions.map((position) => [position.id, passMarkOf(position.screeningSchema)]));
  const day = (date: Date) => formatInTimeZone(date, timeZone, "EEE d MMM");

  const cards: HubCard[] = applications.map((app) => {
    const quizzes = app.quizAssignments;
    const done = quizzes.filter((quiz) => quiz.status === "COMPLETED" && typeof quiz.score === "number");
    const best = done.reduce<number | null>((top, quiz) => Math.max(top ?? 0, quiz.score ?? 0), null);
    const score = best ?? (typeof app.screeningScore === "number" ? app.screeningScore : null);
    const testState: CardFacts["testState"] = score !== null ? "done" : quizzes.length > 0 ? "sent" : "none";
    const offer = record(app.offerDetails);
    const hired = app.hiredUser;
    const invitationPending = Boolean(hired?.invitation && !hired.invitation.acceptedAt && !hired.invitation.revokedAt);
    const signedIn = Boolean(hired && (hired.invitation?.acceptedAt || (!hired.invitation && hired.lastSeenAt)));
    const facts: CardFacts = {
      status: app.status,
      createdAt: app.createdAt.toISOString(),
      testScore: score,
      testState,
      passMark: passMarks.get(app.positionId) ?? null,
      repliesReceived: app.repliesReceived,
      lastReplyAt: app.lastReplyAt?.toISOString() ?? null,
      lastEmailedAt: app.lastEmailedAt?.toISOString() ?? null,
      interviewDate: app.interviewDate?.toISOString() ?? null,
      offerSentAt: typeof offer.sentAt === "string" ? offer.sentAt : null,
      hiredAccount: hired ? { signedIn, invitationPending, invitationExpiresAt: hired.invitation?.expiresAt.toISOString() ?? null } : null,
    };
    const band = cardBand(facts, now);
    const title = app.position?.title ?? "Role removed";
    let subtitle = `${title} · ${relativeDays(app.createdAt, now)}`;
    let detail = app.emailsSent ? `${app.emailsSent} email${app.emailsSent === 1 ? "" : "s"}${app.repliesReceived ? ` · ${app.repliesReceived} repl${app.repliesReceived === 1 ? "y" : "ies"}` : ""}` : "";
    if (app.status === "INTERVIEW" && app.interviewDate) {
      detail = app.interviewDate < now ? `Interviewed ${day(app.interviewDate)}` : `Interview ${day(app.interviewDate)} ${formatInTimeZone(app.interviewDate, timeZone, "HH:mm")}`;
    }
    if (app.status === "OFFER") {
      const parts = [typeof offer.rate === "string" && offer.rate ? offer.rate : null, typeof offer.startDate === "string" && offer.startDate ? `start ${offer.startDate}` : null].filter(Boolean);
      detail = parts.length ? parts.join(" · ") : "Offer details not set";
    }
    if (app.status === "HIRED" && hired) {
      subtitle = `${accountKindLabel(hired.role).replace(/ login$/, "")} account · ${formatInTimeZone(hired.createdAt, timeZone, "d MMM")}`;
      const docs = hired.requestedStaffDocuments;
      const fulfilled = docs.filter((doc) => doc.status === "FULFILLED").length;
      detail = invitationPending && hired.invitation
        ? `Invitation expires ${day(hired.invitation.expiresAt)}`
        : docs.length
          ? `Documents ${fulfilled} of ${docs.length}`
          : "No documents requested";
    }
    const pill = testPill(facts);
    return {
      id: app.id,
      name: app.fullName,
      email: app.email,
      phone: app.phone,
      status: app.status,
      positionId: app.positionId,
      positionTitle: title,
      subtitle,
      tone: band.tone,
      pill: band.pill,
      test: app.status === "HIRED" ? null : pill,
      detail,
      testScore: score,
      testPassed: score === null ? null : score >= (facts.passMark ?? 70),
      testDone: testState === "done",
    };
  });

  const open = applications.filter((app) => !(CLOSED_STAGES as readonly string[]).includes(app.status) && app.status !== "HIRED");
  const openByRole = new Map<string, number>();
  for (const app of open) openByRole.set(app.positionId, (openByRole.get(app.positionId) ?? 0) + 1);

  const roles: HubRole[] = positions.map((position) => {
    const schema = parseScreeningSchema(position.screeningSchema);
    const passMark = passMarkOf(position.screeningSchema);
    return {
      id: position.id,
      title: position.title,
      slug: position.slug,
      subtitle: [position.employmentType, position.location].filter(Boolean).join(" · "),
      isPublished: position.isPublished,
      applications: position._count.applications,
      open: openByRole.get(position.id) ?? 0,
      test: schema ? `On · pass ${passMark ?? schema.passThreshold ?? 70}% · ${schema.questions.length} questions` : "Off",
      hiresBecome: hiresBecomeLabel(position.hireAccountRole),
      hiresBecomeSet: Boolean(position.hireAccountRole),
    };
  });

  const newOnes = applications.filter((app) => app.status === "NEW");
  const oldestNew = newOnes.reduce<Date | null>((oldest, app) => (!oldest || app.createdAt < oldest ? app.createdAt : oldest), null);
  const weekday = Number(formatInTimeZone(now, timeZone, "i"));
  const weekStart = new Date(now.getTime() - (weekday - 1) * DAY);
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY + DAY);
  const interviews = applications
    .filter((app) => app.status === "INTERVIEW" && app.interviewDate && app.interviewDate >= weekStart && app.interviewDate < weekEnd)
    .sort((a, b) => a.interviewDate!.getTime() - b.interviewDate!.getTime());
  const nextInterview = interviews.find((app) => app.interviewDate! >= now);
  const hiredRecent = applications.filter((app) => app.status === "HIRED" && app.hiredUser && now.getTime() - app.hiredUser.createdAt.getTime() <= 90 * DAY);
  const onboarding = hiredRecent.filter((app) => {
    const user = app.hiredUser!;
    const pendingInvite = Boolean(user.invitation && !user.invitation.acceptedAt);
    const docsOpen = user.requestedStaffDocuments.some((doc) => doc.status === "REQUESTED");
    return pendingInvite || docsOpen;
  }).length;
  const capped = applications.length >= READ_LIMIT;
  const published = positions.filter((position) => position.isPublished).length;
  const drafts = positions.length - published;
  const rolesInPipeline = new Set(open.map((app) => app.positionId)).size;
  const figures: HubFigure[] = [
    { label: "Open roles", value: String(published), note: `accepting${drafts ? `, plus ${drafts} draft${drafts === 1 ? "" : "s"}` : ""}` },
    { label: "In the pipeline", value: `${open.length}${capped ? "+" : ""}`, note: `across ${rolesInPipeline} role${rolesInPipeline === 1 ? "" : "s"}` },
    { label: "Need a first look", value: String(newOnes.length), note: oldestNew ? `oldest ${relativeDays(oldestNew, now).replace(" ago", "")}` : "none waiting" },
    { label: "Interviews this week", value: String(interviews.length), note: nextInterview ? `next ${formatInTimeZone(nextInterview.interviewDate!, timeZone, "EEE d MMM HH:mm")}` : "none booked ahead" },
    { label: "Hired, 90 days", value: String(hiredRecent.length), note: `${onboarding} still onboarding` },
  ];
  return {
    cards,
    roles,
    figures,
    closedCounts: { rejected: applications.filter((app) => app.status === "REJECTED").length, withdrawn: applications.filter((app) => app.status === "WITHDRAWN").length },
    capped,
  };
}
