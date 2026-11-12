import "server-only";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { getOpsAccess, getOpsGrants } from "@/lib/rbac/ops-access";
import { countStages, loadPipelineRows } from "@/lib/quotes/pipeline";
import { pipelinePrimary, type PipelineCounts, type PipelineRow } from "@/lib/quotes/pipeline-types";
import type { GrowthSummary } from "./summary-types";

/**
 * The Growth page's figures (owner board "Growth", 2026-11), each read from
 * its own records for the current month in the organisation's timezone. A
 * block is loaded only when the viewer may open the workspace it summarises
 * (administrators always; operations managers by their access areas), so the
 * hub never shows counts a person could not see on the workspace itself.
 */

function monthBounds(now: Date, timezone: string): { start: Date; previousStart: Date } {
  const local = toZonedTime(now, timezone);
  const start = fromZonedTime(new Date(local.getFullYear(), local.getMonth(), 1), timezone);
  const previousStart = fromZonedTime(new Date(local.getFullYear(), local.getMonth() - 1, 1), timezone);
  return { start, previousStart };
}

type Viewer = { id: string; role: string; heldRoles?: string[] };

async function visibleAreas(viewer: Viewer): Promise<Record<"quotes" | "marketing" | "website" | "hiring", boolean>> {
  const levels = await getOpsAccess(viewer);
  if (!levels) return { quotes: true, marketing: true, website: true, hiring: true };
  const grants = await getOpsGrants(viewer);
  const can = (path: string) => canUseOpsPath(levels, path, "GET", grants);
  return { quotes: can("/v2/admin/quotes"), marketing: can("/v2/admin/marketing"), website: can("/v2/admin/website"), hiring: can("/v2/admin/hiring") };
}

/** The next rows to act on: newest new lead first, then sent quotes waiting longest. */
export function nextToAct(rows: PipelineRow[]): Array<{ row: PipelineRow; label: string; href: string | null }> {
  const fresh = rows.filter((row) => row.kind === "lead" && row.status === "NEW").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const waiting = rows.filter((row) => row.kind === "quote" && row.status === "SENT").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return [...fresh.slice(0, 1), ...waiting.slice(0, 1), ...fresh.slice(1, 2)].slice(0, 2).map((row) => {
    const primary = pipelinePrimary(row);
    return { row, label: primary.kind === "none" ? "Open" : primary.label, href: primary.kind === "link" ? primary.href : `/v2/admin/quotes?open=${row.kind}:${row.id}` };
  });
}

export async function loadGrowthSummary(viewer: Viewer, timezone: string, now = new Date()): Promise<GrowthSummary> {
  const areas = await visibleAreas(viewer);
  const { start, previousStart } = monthBounds(now, timezone);

  const [leads, campaigns, website, hiring] = await Promise.all([
    areas.quotes
      ? (async () => {
          const [rows, newThisMonth, newLastMonth, quotesThisMonth, wonThisMonth] = await Promise.all([
            loadPipelineRows(),
            db.quoteLead.count({ where: { createdAt: { gte: start } } }),
            db.quoteLead.count({ where: { createdAt: { gte: previousStart, lt: start } } }),
            db.quote.count({ where: { createdAt: { gte: start } } }),
            db.quote.count({ where: { createdAt: { gte: start }, status: "CONVERTED" } }),
          ]);
          const counts: PipelineCounts = countStages(rows);
          return { counts, newThisMonth, newLastMonth, quotesThisMonth, wonThisMonth, next: nextToAct(rows).map(({ row, label, href }) => ({ name: row.name, detail: [row.reference, row.suburb].filter(Boolean).join(" · "), status: row.status, label, href })) };
        })()
      : null,
    areas.marketing
      ? (async () => {
          const [sent, recent] = await Promise.all([
            db.emailCampaign.findMany({ where: { sentAt: { gte: start } }, select: { id: true, recipientCount: true } }),
            db.emailCampaign.findMany({ orderBy: { updatedAt: "desc" }, take: 4, select: { id: true, name: true, channel: true, status: true, sentAt: true, recipientCount: true } }),
          ]);
          const ids = sent.map((row) => row.id);
          const opens = ids.length ? await db.emailCampaignEvent.count({ where: { campaignId: { in: ids }, type: "OPENED" } }) : 0;
          const recipientsKnown = sent.every((row) => row.recipientCount != null);
          return {
            sentThisMonth: sent.length,
            recipientsThisMonth: recipientsKnown ? sent.reduce((sum, row) => sum + (row.recipientCount ?? 0), 0) : null,
            opensThisMonth: opens > 0 ? opens : null,
            recent: recent.map((row) => ({ id: row.id, name: row.name, channel: String(row.channel), status: row.status, sentAt: row.sentAt?.toISOString() ?? null, recipients: row.recipientCount ?? null })),
          };
        })()
      : null,
    areas.website
      ? (async () => {
          const [published, drafts] = await Promise.all([
            db.blogPost.count({ where: { isPublished: true } }),
            db.blogPost.findMany({ where: { isPublished: false }, orderBy: { updatedAt: "desc" }, take: 2, select: { id: true, title: true, updatedAt: true } }),
          ]);
          return { publishedPosts: published, drafts: drafts.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() })) };
        })()
      : null,
    areas.hiring
      ? (async () => {
          const [byStatus, positions] = await Promise.all([
            db.hiringApplication.groupBy({ by: ["status"], _count: { _all: true } }),
            db.hiringPosition.findMany({ orderBy: { updatedAt: "desc" }, take: 3, select: { id: true, title: true, isPublished: true, _count: { select: { applications: true } } } }),
          ]);
          const stage = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
          return {
            applied: stage("NEW"),
            screening: stage("SCREENING"),
            interview: stage("INTERVIEW"),
            offer: stage("OFFER"),
            positions: positions.map((row) => ({ id: row.id, title: row.title, published: row.isPublished, applications: row._count.applications })),
          };
        })()
      : null,
  ]);

  return { monthStart: start.toISOString(), leads, campaigns, website, hiring };
}
