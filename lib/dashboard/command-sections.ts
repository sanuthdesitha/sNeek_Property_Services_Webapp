/**
 * Command section loaders (server). Each section is read on its own so one
 * failing query fails one section; inside a section each figure is read on
 * its own and an unreadable figure is shown as unavailable, never as zero.
 */
import { JobStatus, QaAssignmentStatus } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { listClientInvoices } from "@/lib/billing/client-invoice-list";
import { getAppSettings } from "@/lib/settings";
import { loadLiveBoard } from "@/lib/ops/live-board";
import { addDaysToKey, sydneyTodayKey } from "@/lib/time/sydney-range";
import { viewerCanOpen, viewerHasFeature, type CommandViewer } from "./command-viewer";
import { buildTodayByCleaner } from "./today-by-cleaner";
import * as links from "./work-queue-links";
import type { CommandTile, CommandTilesPayload, TodayByCleanerPayload } from "./command-types";

export async function commandTimeZone(): Promise<string> {
  const settings = await getAppSettings().catch(() => null);
  return settings?.timezone || "Australia/Sydney";
}

function utcDay(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-AU")}`;
}

export type CommandHeaderFacts = { dateLabel: string; summary: string | null };

/** h1 date and the one-line summary (jobs today · cleaners on shift · same-day arrivals before 3 pm). */
export async function loadCommandHeader(now: Date, timeZone: string): Promise<CommandHeaderFacts> {
  const dateLabel = formatInTimeZone(now, timeZone, "EEEE d MMMM");
  try {
    const board = await loadLiveBoard({ now, timeZone, withProgress: false });
    const jobs = board.jobs.length;
    const arrivals = board.jobs.filter((job) => job.state !== "done" && job.sameDayCheckinTime && job.sameDayCheckinTime < "15:00").length;
    const parts = [
      `${jobs} job${jobs === 1 ? "" : "s"} today`,
      `${board.counts.cleanersOnShift} cleaner${board.counts.cleanersOnShift === 1 ? "" : "s"} on shift`,
    ];
    if (arrivals > 0) parts.push(`${arrivals} guest arrival${arrivals === 1 ? "" : "s"} before 3 pm`);
    return { dateLabel, summary: parts.join(" · ") };
  } catch {
    return { dateLabel, summary: null };
  }
}

const UNAVAILABLE = { text: "Unavailable", tone: "neutral" } as const;

async function unassignedTile(now: Date): Promise<CommandTile> {
  const todayKey = sydneyTodayKey(now);
  const href = links.unassignedSoonHref(todayKey);
  const label = "Unassigned, next 48 h";
  try {
    const count = await db.job.count({ where: { status: JobStatus.UNASSIGNED, scheduledDate: { gte: utcDay(todayKey), lt: utcDay(addDaysToKey(todayKey, 2)) } } });
    return { key: "unassigned", label, count, href, badge: count > 0 ? { text: "Needs you", tone: "bad" } : { text: "All covered", tone: "ok" } };
  } catch {
    return { key: "unassigned", label, count: null, href, badge: UNAVAILABLE };
  }
}

async function lateTile(now: Date, timeZone: string): Promise<CommandTile> {
  const label = "Running late";
  const href = links.LIVE_OPS_EXCEPTIONS_HREF;
  try {
    const board = await loadLiveBoard({ now, timeZone, withProgress: false });
    const late = board.jobs.filter((job) => job.state === "late");
    const worst = late.reduce((max, job) => Math.max(max, job.minutes ?? 0), 0);
    return { key: "late", label, count: late.length, href, badge: late.length > 0 ? { text: `${worst} min behind`, tone: "warn" } : { text: "On time", tone: "ok" } };
  } catch {
    return { key: "late", label, count: null, href, badge: UNAVAILABLE };
  }
}

async function qaTile(now: Date): Promise<CommandTile> {
  const label = "Waiting for QA";
  const href = links.QUALITY_REVIEW_HREF;
  try {
    const where = { status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED] } };
    const [count, oldest] = await Promise.all([
      db.qaAssignment.count({ where }),
      db.qaAssignment.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);
    const hours = oldest ? Math.max(0, Math.floor((now.getTime() - oldest.createdAt.getTime()) / 3_600_000)) : null;
    const badge = count === 0 || hours == null
      ? { text: "Queue clear", tone: "ok" as const }
      : { text: hours >= 48 ? `Oldest ${Math.floor(hours / 24)} days` : `Oldest ${hours} h`, tone: "neutral" as const };
    return { key: "qa", label, count, href, badge };
  } catch {
    return { key: "qa", label, count: null, href, badge: UNAVAILABLE };
  }
}

async function invoicesTile(now: Date): Promise<CommandTile> {
  const label = "Invoices to send";
  const href = links.INVOICES_NEEDS_ACTION_HREF;
  try {
    // The Invoices list's own "Needs action" filter, so the tile and the page agree.
    const [list, drafts] = await Promise.all([
      listClientInvoices({
        query: { page: 1, pageSize: 1, sort: "created", dir: "desc", skip: 0, take: 1 },
        filters: { status: "needs-action", clientId: null, periodFrom: null, periodTo: null, xero: "any", search: null },
        now,
      }),
      db.clientInvoice.aggregate({ where: { status: "DRAFT" }, _sum: { totalAmount: true } }),
    ]);
    const count = list.total;
    const draftTotal = drafts._sum.totalAmount ?? 0;
    const badge = count === 0 ? { text: "Nothing to send", tone: "ok" as const } : { text: `${money(draftTotal)} in drafts`, tone: "gold" as const };
    return { key: "invoices", label, count, href, badge };
  } catch {
    return { key: "invoices", label, count: null, href, badge: UNAVAILABLE };
  }
}

/** The four tiles, each only for a viewer who can open its destination. */
export async function loadCommandTiles(viewer: CommandViewer, now: Date, timeZone: string): Promise<CommandTilesPayload> {
  const tasks: Array<Promise<CommandTile>> = [];
  if (viewerCanOpen(viewer, links.unassignedSoonHref(sydneyTodayKey(now)))) tasks.push(unassignedTile(now));
  if (viewerCanOpen(viewer, links.LIVE_OPS_HREF)) tasks.push(lateTile(now, timeZone));
  if (viewerCanOpen(viewer, links.QUALITY_REVIEW_HREF)) tasks.push(qaTile(now));
  if (viewerHasFeature(viewer, "finance") && viewerCanOpen(viewer, links.INVOICES_NEEDS_ACTION_HREF)) tasks.push(invoicesTile(now));
  return { tiles: await Promise.all(tasks) };
}

export async function loadTodayByCleaner(now: Date, timeZone: string): Promise<TodayByCleanerPayload> {
  const board = await loadLiveBoard({ now, timeZone, withProgress: false });
  const [h, m] = formatInTimeZone(now, timeZone, "HH:mm").split(":").map(Number);
  return buildTodayByCleaner(board.jobs, h * 60 + m);
}
