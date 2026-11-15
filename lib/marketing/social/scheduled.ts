import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { sendOfficeNotification, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { networkDefinition, type SocialNetwork } from "./networks";
import { publishGroup, PublishRefused, type PublishDeps } from "./publish";
import type { PublishResultRow } from "./view-types";

/**
 * Planned social posts (2026-11-17; owner default pending confirmation): a
 * post a PERSON planned is sent by sNeek at its time, for connected
 * networks only, through the same checks and the same one-attempt claim as
 * a click (pg-boss `social-planned-posts`, every 5 minutes). Before sending:
 * the planner's right (live), the "I looked at every photo" tick, every
 * photo's permission and eligibility, the connection. Nothing a person did
 * not plan is ever sent.
 *
 * Bounded policy: no automatic retries. A failure, a refusal or a run more
 * than 6 hours late (sNeek was not running) is recorded on the network row
 * with its reason and reported once to the planner's inbox; a person may
 * retry from the post. Queued is not delivered.
 */

export const SOCIAL_RESULT_TYPE = "marketing.social_post_result";
const LATE_LIMIT_MS = 6 * 3_600_000;

function outcomeWords(rows: PublishResultRow[]): string {
  return rows.map((row) => {
    const label = networkDefinition(row.network).label;
    if (row.outcome === "POSTED") return `${label}: posted.`;
    if (row.outcome === "UNCONFIRMED") return `${label}: not confirmed, check it before retrying.`;
    if (row.outcome === "ALREADY") return `${label}: already sent.`;
    if (row.outcome === "NOT_CONNECTED") return `${label}: not sent (not connected).`;
    return `${label}: not posted. ${row.message}`;
  }).join(" ");
}

function summaryWords(rows: PublishResultRow[]): string {
  const posted = rows.filter((row) => row.outcome === "POSTED").length;
  const problems = rows.length - posted;
  if (problems === 0) return `${posted} posted`;
  if (posted === 0) return "not posted";
  return `${posted} posted, ${problems} need you`;
}

async function notifyPlanner(input: { groupId: string; title: string; plannedFor: Date; plannerId: string | null; rows: PublishResultRow[] }): Promise<RecipientOutcome[]> {
  if (!input.plannerId) return [];
  const planner = await db.user.findUnique({ where: { id: input.plannerId }, select: { id: true, role: true, name: true, email: true, isActive: true } });
  if (!planner?.isActive || (planner.role !== Role.ADMIN && planner.role !== Role.OPS_MANAGER)) return [];
  const timeZone = (await getAppSettings()).timezone || "Australia/Sydney";
  const wording = await loadNotificationWording(SOCIAL_RESULT_TYPE);
  const inbox = wording.render("planned_result", "INBOX", {
    title: input.title,
    plannedFor: formatInTimeZone(input.plannedFor, timeZone, "EEE d MMM, HH:mm"),
    results: outcomeWords(input.rows),
    summary: summaryWords(input.rows),
  });
  const controls = await getNotificationTypeControls();
  return sendOfficeNotification({
    typeKey: SOCIAL_RESULT_TYPE,
    eventKey: SOCIAL_RESULT_TYPE,
    eventId: `social-planned:${input.groupId}:${input.plannedFor.toISOString()}`,
    entity: { type: "SocialPostGroup", id: input.groupId },
    actorId: null,
    scopeType: "STAFF_MEMBER",
    scopeId: (recipient) => recipient.id,
    category: "approvals",
    severity: input.rows.every((row) => row.outcome === "POSTED") ? "INFO" : "ACTION",
    jobId: null,
    subject: inbox.title ?? `Planned social post: ${summaryWords(input.rows)}`,
    body: inbox.body,
    url: `/v2/admin/marketing?tab=social&view=create&group=${encodeURIComponent(input.groupId)}`,
    transports: ["INBOX"],
    recipients: [{ id: planner.id, role: planner.role, name: planner.name, email: planner.email }],
    respectsPreferences: false,
    disabledTransports: controls.disabledTransports[SOCIAL_RESULT_TYPE] ?? [],
  });
}

async function failRows(postIds: string[], reason: string, code: string) {
  await db.socialPost.updateMany({ where: { id: { in: postIds }, status: "SCHEDULED" }, data: { status: "FAILED", failureReason: reason, failureCode: code } });
}

/** One run of the planned-posts job. */
export async function processPlannedSocialPosts(deps: PublishDeps & { notify?: typeof notifyPlanner } = {}): Promise<{ groups: number; posted: number; failed: number }> {
  const now = deps.now ?? new Date();
  const due = await db.socialPost.findMany({
    where: { status: "SCHEDULED", deliveryMode: "API", groupId: { not: null }, scheduledFor: { lte: now } },
    select: { id: true, channel: true, groupId: true, scheduledFor: true },
    orderBy: { scheduledFor: "asc" },
    take: 100,
  });
  const byGroup = new Map<string, typeof due>();
  for (const post of due) byGroup.set(post.groupId!, [...(byGroup.get(post.groupId!) ?? []), post]);
  const notify = deps.notify ?? notifyPlanner;
  let posted = 0;
  let failed = 0;
  for (const [groupId, posts] of Array.from(byGroup.entries())) {
    const group = await db.socialPostGroup.findUnique({ where: { id: groupId }, select: { id: true, title: true, plannedById: true, plannedFor: true } });
    if (!group) continue;
    const plannedFor = posts[0].scheduledFor ?? now;
    let rows: PublishResultRow[];
    if (now.getTime() - plannedFor.getTime() > LATE_LIMIT_MS) {
      const reason = "Missed its planned time by more than 6 hours (sNeek was not running then). Nothing was posted; post it again if it is still wanted.";
      await failRows(posts.map((post) => post.id), reason, "MISSED_TIME");
      rows = posts.map((post) => ({ network: post.channel as SocialNetwork, outcome: "FAILED" as const, message: reason, externalUrl: null }));
    } else if (!group.plannedById) {
      const reason = "Nobody is recorded as planning this post, so it was not sent.";
      await failRows(posts.map((post) => post.id), reason, "NO_PLANNER");
      rows = posts.map((post) => ({ network: post.channel as SocialNetwork, outcome: "FAILED" as const, message: reason, externalUrl: null }));
    } else {
      try {
        rows = await publishGroup({ groupId, networks: posts.map((post) => post.channel as SocialNetwork), actorId: group.plannedById, trigger: "SCHEDULE" }, deps);
      } catch (error) {
        const reason = error instanceof PublishRefused ? `Not sent: ${error.problems.join(" ")}` : "Not sent: the post could not be checked. Nothing was posted.";
        if (!(error instanceof PublishRefused)) logger.error({ err: error instanceof Error ? error.message : "unknown", groupId }, "[social] planned post failed");
        await failRows(posts.map((post) => post.id), reason.slice(0, 1000), "REFUSED_AT_TIME");
        rows = posts.map((post) => ({ network: post.channel as SocialNetwork, outcome: "REFUSED" as const, message: reason, externalUrl: null }));
      }
    }
    posted += rows.filter((row) => row.outcome === "POSTED").length;
    failed += rows.filter((row) => row.outcome !== "POSTED").length;
    await notify({ groupId, title: group.title, plannedFor, plannerId: group.plannedById, rows }).catch((error) => {
      logger.error({ err: error instanceof Error ? error.message : "unknown", groupId }, "[social] planned result notice failed");
    });
  }
  return { groups: byGroup.size, posted, failed };
}
