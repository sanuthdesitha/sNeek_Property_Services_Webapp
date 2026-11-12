import "server-only";
import { Prisma, Role, type LaundryTeamRequestReply } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { LAUNDRY_TEAM_REQUEST_KINDS, type LaundryTeamRequestKind } from "./nudge-rules";
import { laundryTaskScope } from "./teams";
import {
  DATE_PATTERN,
  TEAM_REPLY_ANSWERS,
  TIME_PATTERN,
  isTeamReplyAnswer,
  plannedTimeFromAnswer,
  teamReplyProblem,
  type TeamReplyAnswer,
  type TeamReplySummary,
} from "./team-request-reply-rules";

/**
 * Laundry team answers to "Ask laundry team" requests (laundry portal, "From
 * the office"). Rules:
 * - only a LAUNDRY account, never while impersonating (the route checks);
 * - the request must exist (audit LAUNDRY_TEAM_REQUEST_SENT) and the run must
 *   be one this person may see under the laundry visibility rule;
 * - the person was asked, or is on the run's laundry partner team now;
 * - the answer must fit the request kind (team-request-reply-rules.ts);
 * - one idempotency key = one answer: a retry with the same key returns the
 *   stored answer, the same key for anything else is refused.
 * An answer records what the team said. One exception (owner decision
 * 2026-11-13): "Yes, <time>" to a confirm-pickup / move-pickup / confirm-drop
 * request sets the run's planned pickup / drop TIME in the same transaction,
 * audited as set from the laundry team's answer, only when the time is valid
 * and the run is still open for that leg (`plannedTimeFromAnswer`). Never the
 * date, the status or any schedule rule; the office can change it as today.
 */
export const TEAM_REQUEST_REPLY_ACTION = "LAUNDRY_TEAM_REQUEST_REPLIED";

export class TeamReplyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const teamReplySchema = z.object({
  answer: z.enum(TEAM_REPLY_ANSWERS as [TeamReplyAnswer, ...TeamReplyAnswer[]]),
  time: z.string().trim().regex(TIME_PATTERN).nullable().optional(),
  date: z.string().trim().regex(DATE_PATTERN).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
}).strict();

export type TeamReplyViewer = { id: string; role: Role | string; name?: string | null };

type ReplyRow = LaundryTeamRequestReply;

function dayKeyOfDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toReplySummary(row: ReplyRow): TeamReplySummary {
  return {
    id: row.id,
    requestKind: row.requestKind,
    answer: isTeamReplyAnswer(row.answer) ? row.answer : "MESSAGE",
    time: row.answerTime,
    date: dayKeyOfDate(row.answerDate),
    note: row.note,
    byName: row.repliedByName?.trim() || "Laundry team member",
    at: row.createdAt.toISOString(),
  };
}

function isRequestKind(value: unknown): value is LaundryTeamRequestKind {
  return typeof value === "string" && (LAUNDRY_TEAM_REQUEST_KINDS as readonly string[]).includes(value);
}

/** The request (audit row) with its kind and recipients, or a refusal. */
async function loadRequest(requestId: string) {
  const row = await db.auditLog.findFirst({
    where: { id: requestId, action: "LAUNDRY_TEAM_REQUEST_SENT", entity: "LaundryTask" },
    select: { id: true, entityId: true, after: true },
  });
  const after = (row?.after ?? {}) as { kind?: unknown; recipientIds?: unknown };
  if (!row?.entityId || !isRequestKind(after.kind)) throw new TeamReplyError(404, "That request was not found.");
  const recipients = Array.isArray(after.recipientIds) ? after.recipientIds.filter((id): id is string => typeof id === "string") : [];
  return { id: row.id, taskId: row.entityId, kind: after.kind, recipients };
}

export type PlannedTimeFromAnswer = { field: "pickupTime" | "dropoffTime"; time: string };

export type TeamReplyResult = { reply: TeamReplySummary; replayed: boolean; plannedTimeSet: PlannedTimeFromAnswer | null };

export const PLANNED_TIME_FROM_ANSWER_ACTION = "LAUNDRY_PLANNED_TIMES_UPDATED";

/** Inside the reply transaction: lock the run and set its planned time when the answer calls for it. */
async function applyPlannedTimeFromAnswer(
  tx: Prisma.TransactionClient,
  args: { taskId: string; jobId: string; kind: LaundryTeamRequestKind; answer: TeamReplyAnswer; time: string | null | undefined; actorId: string; replyId: string; requestId: string },
): Promise<PlannedTimeFromAnswer | null> {
  await tx.$queryRaw`SELECT "id" FROM "LaundryTask" WHERE "id" = ${args.taskId} FOR UPDATE`;
  const run = await tx.laundryTask.findUnique({ where: { id: args.taskId }, select: { status: true, pickupTime: true, dropoffTime: true } });
  if (!run) return null;
  const change = plannedTimeFromAnswer({ kind: args.kind, answer: args.answer, time: args.time ?? null, status: run.status });
  if (!change) return null;
  const current = change.field === "pickupTime" ? run.pickupTime : run.dropoffTime;
  if (current === change.time) return null;
  await tx.laundryTask.update({ where: { id: args.taskId }, data: { [change.field]: change.time } });
  await tx.auditLog.create({
    data: {
      userId: args.actorId, jobId: args.jobId, action: PLANNED_TIME_FROM_ANSWER_ACTION, entity: "LaundryTask", entityId: args.taskId,
      before: { pickupTime: run.pickupTime, dropoffTime: run.dropoffTime } as Prisma.InputJsonObject,
      after: {
        pickupTime: change.field === "pickupTime" ? change.time : run.pickupTime,
        dropoffTime: change.field === "dropoffTime" ? change.time : run.dropoffTime,
        source: "LAUNDRY_TEAM_ANSWER", label: "Set from laundry team's answer", requestId: args.requestId, replyId: args.replyId,
      } as Prisma.InputJsonObject,
    },
  });
  return change;
}

export async function recordTeamRequestReply(viewer: TeamReplyViewer, requestId: string, input: unknown, now = new Date()): Promise<TeamReplyResult> {
  if (viewer.role !== Role.LAUNDRY) throw new TeamReplyError(403, "Only the laundry team answers office requests.");
  const body = teamReplySchema.parse(input);
  const request = await loadRequest(requestId);

  const existing = await db.laundryTeamRequestReply.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
  if (existing) {
    if (existing.requestAuditId === request.id && existing.repliedById === viewer.id && existing.answer === body.answer) {
      return { reply: toReplySummary(existing), replayed: true, plannedTimeSet: null };
    }
    throw new TeamReplyError(409, "This answer key was already used for a different answer. Reload and answer again.");
  }

  const scope = await laundryTaskScope(viewer);
  const [task, me] = await Promise.all([
    db.laundryTask.findFirst({ where: { ...scope, id: request.taskId }, select: { id: true, jobId: true, supplierId: true } }),
    db.user.findUnique({ where: { id: viewer.id }, select: { name: true, laundrySupplierId: true, isActive: true } }),
  ]);
  if (!task) throw new TeamReplyError(404, "That run is not one you can see.");
  if (!me?.isActive) throw new TeamReplyError(403, "This account is not active.");
  const asked = request.recipients.includes(viewer.id);
  const onTeam = Boolean(task.supplierId) && me.laundrySupplierId === task.supplierId;
  if (!asked && !onTeam) throw new TeamReplyError(403, "This request was for another laundry team.");

  const problem = teamReplyProblem(request.kind, body, sydneyTodayKey(now));
  if (problem) throw new TeamReplyError(400, problem);

  try {
    const saved = await db.$transaction(async (tx) => {
      const created = await tx.laundryTeamRequestReply.create({
        data: {
          laundryTaskId: task.id,
          requestAuditId: request.id,
          requestKind: request.kind,
          answer: body.answer,
          answerTime: body.time || null,
          answerDate: body.date ? new Date(`${body.date}T00:00:00.000Z`) : null,
          note: body.note?.trim() || null,
          repliedById: viewer.id,
          repliedByName: me.name?.trim() || viewer.name?.trim() || null,
          idempotencyKey: body.idempotencyKey,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: TEAM_REQUEST_REPLY_ACTION,
          entity: "LaundryTask",
          entityId: task.id,
          after: { requestId: request.id, requestKind: request.kind, answer: body.answer, time: body.time ?? null, date: body.date ?? null, note: body.note ?? null, replyId: created.id } as Prisma.InputJsonValue,
        },
      });
      const plannedTimeSet = await applyPlannedTimeFromAnswer(tx, {
        taskId: task.id, jobId: task.jobId, kind: request.kind, answer: body.answer, time: body.time, actorId: viewer.id, replyId: created.id, requestId: request.id,
      });
      return { created, plannedTimeSet };
    });
    return { reply: toReplySummary(saved.created), replayed: false, plannedTimeSet: saved.plannedTimeSet };
  } catch (error) {
    // Two taps with the same key at once: the unique key decides, the loser replays.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await db.laundryTeamRequestReply.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
      if (winner && winner.requestAuditId === request.id && winner.repliedById === viewer.id) return { reply: toReplySummary(winner), replayed: true, plannedTimeSet: null };
      throw new TeamReplyError(409, "This answer key was already used. Reload and answer again.");
    }
    throw error;
  }
}

/** Replies for runs (office run panel and the portal inbox), newest first, bounded. */
export async function loadTeamReplies(where: { taskIds?: string[]; requestIds?: string[] }, sinceDays = 14, now = new Date()): Promise<ReplyRow[]> {
  const taskIds = where.taskIds?.filter(Boolean) ?? [];
  const requestIds = where.requestIds?.filter(Boolean) ?? [];
  if (!taskIds.length && !requestIds.length) return [];
  const since = new Date(now.getTime() - sinceDays * 86_400_000);
  const or: Prisma.LaundryTeamRequestReplyWhereInput[] = [];
  if (taskIds.length) or.push({ laundryTaskId: { in: taskIds } });
  if (requestIds.length) or.push({ requestAuditId: { in: requestIds } });
  return db.laundryTeamRequestReply.findMany({ where: { OR: or, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 500 });
}

/** Group replies per run, newest first, at most `limit` each. */
export function repliesByTask(rows: ReplyRow[], limit = 5): Map<string, TeamReplySummary[]> {
  const out = new Map<string, TeamReplySummary[]>();
  for (const row of rows) {
    const list = out.get(row.laundryTaskId) ?? [];
    if (list.length < limit) list.push(toReplySummary(row));
    out.set(row.laundryTaskId, list);
  }
  return out;
}
