/**
 * Per-record work queue sources: one row per job, request or record, capped,
 * with an overflow row that links to the filtered page for the rest. Every
 * total is a real count, never the length of a capped list.
 */
import { JobStatus } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { listShoppingRunsForAdmin } from "@/lib/inventory/shopping-runs";
import { addDaysToKey } from "@/lib/time/sydney-range";
import {
  DOCUMENT_WINDOW_DAYS,
  KIND_CATEGORY,
  KIND_URGENCY,
  NEW_LEAD_HOURS,
  PER_KIND_ROW_CAP,
  STALE_CASE_HOURS,
  documentUrgency,
  plural,
  unassignedUrgency,
} from "./work-queue-rules";
import * as links from "./work-queue-links";
import type { WorkQueueAction, WorkQueueItem, WorkQueueKind } from "./work-queue-types";

export type QueueContext = { now: Date; todayKey: string; timeZone: string };

function utcDay(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function dayLabel(scheduledKey: string, todayKey: string): string {
  if (scheduledKey === todayKey) return "today";
  if (scheduledKey === addDaysToKey(todayKey, 1)) return "tomorrow";
  return formatInTimeZone(utcDay(scheduledKey), "UTC", "EEE d MMM");
}

function money(amount: number): string {
  return `$${amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function humanJobType(value: string): string {
  const text = value.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function row(kind: WorkQueueKind, fields: Omit<WorkQueueItem, "kind" | "category" | "urgency" | "count"> &
  Partial<Pick<WorkQueueItem, "urgency" | "count">>): WorkQueueItem {
  return { kind, category: KIND_CATEGORY[kind], urgency: fields.urgency ?? KIND_URGENCY[kind], count: fields.count ?? 1, ...fields };
}

/** The "and N more" row for a capped per-record kind. */
function overflow(kind: WorkQueueKind, shown: number, total: number, noun: string, href: string): WorkQueueItem[] {
  const rest = total - shown;
  if (rest <= 0) return [];
  return [row(kind, { id: `${kind}:more`, title: `${plural(rest, `more ${noun}`, `more ${noun}s`)}`, detail: "Open the filtered list to see them all.", href, count: rest, actions: [] })];
}

export async function unassignedSoonItems(ctx: QueueContext): Promise<{ items: WorkQueueItem[]; total: number }> {
  const where = {
    status: JobStatus.UNASSIGNED,
    scheduledDate: { gte: utcDay(ctx.todayKey), lt: utcDay(addDaysToKey(ctx.todayKey, 2)) },
  };
  const [total, jobs] = await Promise.all([
    db.job.count({ where }),
    db.job.findMany({
      where,
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
      take: PER_KIND_ROW_CAP,
      select: {
        id: true, scheduledDate: true, startTime: true, jobType: true, sameDayCheckin: true, sameDayCheckinTime: true,
        property: { select: { name: true, suburb: true } },
      },
    }),
  ]);
  const items = jobs.map((job) => {
    const key = job.scheduledDate.toISOString().slice(0, 10);
    const guest = job.sameDayCheckin && job.sameDayCheckinTime ? ` · guest arrives ${job.sameDayCheckinTime}` : "";
    return row("unassigned-soon", {
      id: `unassigned:${job.id}`,
      urgency: unassignedUrgency(key, ctx.todayKey),
      title: `Unassigned clean, ${dayLabel(key, ctx.todayKey)}${job.startTime ? ` ${job.startTime}` : ""}`,
      detail: `${job.property.name}${job.property.suburb ? `, ${job.property.suburb}` : ""} · ${humanJobType(job.jobType)}${guest}`,
      href: links.jobHref(job.id),
      actions: [
        { kind: "assign", label: "Suggest cleaner", jobId: job.id },
        { kind: "assign", label: "Assign", jobId: job.id, primary: true },
      ],
    });
  });
  return { items: [...items, ...overflow("unassigned-soon", items.length, total, "unassigned job", links.unassignedSoonHref(ctx.todayKey))], total };
}

export async function continuationItems(): Promise<WorkQueueItem[]> {
  const requests = await listContinuationRequests({ status: "PENDING" });
  const jobIds = Array.from(new Set(requests.map((request) => request.jobId)));
  const userIds = Array.from(new Set(requests.map((request) => request.requestedByUserId)));
  const [jobs, users] = await Promise.all([
    jobIds.length ? db.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, property: { select: { name: true } } } }) : [],
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const nameById = new Map(users.map((user) => [user.id, user.name]));
  return requests.map((request) => {
    const endpoint = `/api/admin/job-continuations/${encodeURIComponent(request.id)}`;
    const remaining = request.estimatedRemainingHours != null ? `${request.estimatedRemainingHours} h left · ` : "";
    const decline: WorkQueueAction = { kind: "request", label: "Decline", method: "PATCH", endpoint, body: { decision: "REJECT" }, doneLabel: "Continuation declined" };
    const approve: WorkQueueAction = { kind: "request", label: "Approve", method: "PATCH", endpoint, body: { decision: "APPROVE" }, doneLabel: "Continuation approved", primary: true };
    return row("continuation", {
      id: `continuation:${request.id}`,
      title: `${nameById.get(request.requestedByUserId) ?? "A cleaner"} asks to continue${request.preferredDate ? ` on ${request.preferredDate}` : " later"}`,
      detail: `${jobById.get(request.jobId)?.property.name ?? "Job"} · ${remaining}reason: ${request.reason || "not given"}`,
      href: links.jobHref(request.jobId),
      actions: [decline, approve],
    });
  });
}

export async function staleCaseItems(ctx: QueueContext): Promise<WorkQueueItem[]> {
  const where = { status: { in: ["OPEN", "IN_PROGRESS"] }, createdAt: { lte: new Date(ctx.now.getTime() - STALE_CASE_HOURS * 3_600_000) } };
  const [total, cases] = await Promise.all([
    db.issueTicket.count({ where }),
    db.issueTicket.findMany({
      where, orderBy: [{ severity: "desc" }, { updatedAt: "asc" }], take: PER_KIND_ROW_CAP,
      select: { id: true, title: true, severity: true, caseType: true, createdAt: true, jobId: true, property: { select: { name: true } } },
    }),
  ]);
  const items = cases.map((item) => row("case-stale", {
    id: `case-stale:${item.id}`,
    overlap: true,
    title: `Case open since ${formatInTimeZone(item.createdAt, ctx.timeZone, "d MMM")}: ${item.title}`,
    detail: [item.property?.name, item.caseType, item.severity].filter(Boolean).join(" · "),
    href: links.CASES_HREF,
    actions: [
      { kind: "link", label: "Open case", href: links.CASES_HREF },
      ...(item.jobId ? [{ kind: "link" as const, label: "Open job", href: links.jobHref(item.jobId) }] : []),
    ],
  }));
  return [...items, ...overflow("case-stale", items.length, total, "stale case", links.CASES_HREF).map((item) => ({ ...item, overlap: true }))];
}

export async function laundryExceptionItems(ctx: QueueContext): Promise<{ items: WorkQueueItem[]; flaggedInWindow: number }> {
  const window = { gte: utcDay(ctx.todayKey), lt: utcDay(addDaysToKey(ctx.todayKey, 2)) };
  const where = { status: { in: ["FLAGGED", "SKIPPED_PICKUP"] as ("FLAGGED" | "SKIPPED_PICKUP")[] }, OR: [{ pickupDate: window }, { dropoffDate: window }] };
  const [total, flaggedInWindow, tasks] = await Promise.all([
    db.laundryTask.count({ where }),
    db.laundryTask.count({ where: { ...where, status: "FLAGGED" } }),
    db.laundryTask.findMany({
      where, orderBy: [{ updatedAt: "desc" }], take: PER_KIND_ROW_CAP,
      select: { id: true, status: true, pickupDate: true, dropoffDate: true, property: { select: { name: true } } },
    }),
  ]);
  const items = tasks.map((task) => row("laundry-exception", {
    id: `laundry:${task.id}`,
    title: `Laundry ${task.status === "FLAGGED" ? "flagged" : "pickup skipped"}: ${task.property.name}`,
    detail: `Pickup ${formatInTimeZone(task.pickupDate, "UTC", "d MMM")} · drop-off ${formatInTimeZone(task.dropoffDate, "UTC", "d MMM")}`,
    href: links.LAUNDRY_HREF,
    actions: [{ kind: "link", label: "Open laundry", href: links.LAUNDRY_HREF }],
  }));
  return { items: [...items, ...overflow("laundry-exception", items.length, total, "laundry exception", links.LAUNDRY_HREF)], flaggedInWindow };
}

export async function newLeadItems(ctx: QueueContext): Promise<WorkQueueItem[]> {
  const where = { createdAt: { gte: new Date(ctx.now.getTime() - NEW_LEAD_HOURS * 3_600_000) } };
  const [total, leads] = await Promise.all([
    db.quoteLead.count({ where }),
    db.quoteLead.findMany({
      where, orderBy: { createdAt: "desc" }, take: PER_KIND_ROW_CAP,
      select: { id: true, name: true, suburb: true, serviceType: true, createdAt: true, quotes: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 } },
    }),
  ]);
  const items = leads.map((lead) => {
    const quoteId = lead.quotes[0]?.id;
    const href = quoteId ? links.quoteHref(quoteId) : links.QUOTES_HREF;
    return row("lead-new", {
      id: `lead:${lead.id}`,
      title: `New lead: ${lead.name}`,
      detail: `${lead.suburb || "Area not set"} · ${humanJobType(lead.serviceType)} · received ${formatInTimeZone(lead.createdAt, ctx.timeZone, "d MMM HH:mm")}`,
      href,
      actions: [{ kind: "link", label: quoteId ? "Open quote" : "Open pipeline", href }],
    });
  });
  return [...items, ...overflow("lead-new", items.length, total, "new lead", links.QUOTES_HREF)];
}

export async function expiringDocumentItems(ctx: QueueContext): Promise<WorkQueueItem[]> {
  const where = { expiresAt: { gte: ctx.now, lte: new Date(ctx.now.getTime() + DOCUMENT_WINDOW_DAYS * 86_400_000) } };
  const [total, docs] = await Promise.all([
    db.staffDocument.count({ where }),
    db.staffDocument.findMany({
      where, orderBy: { expiresAt: "asc" }, take: PER_KIND_ROW_CAP,
      select: { id: true, title: true, category: true, expiresAt: true, user: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  const items = docs.map((doc) => {
    const expires = doc.expiresAt as Date;
    const days = Math.max(0, Math.ceil((expires.getTime() - ctx.now.getTime()) / 86_400_000));
    const href = links.accountHref(doc.user.id);
    return row("document-expiring", {
      id: `document:${doc.id}`,
      urgency: documentUrgency(expires, ctx.now),
      title: `${doc.title} expires ${days === 0 ? "today" : `in ${plural(days, "day")}`}`,
      detail: `${doc.user.name ?? doc.user.email} · ${doc.category}`,
      href,
      actions: [{ kind: "link", label: "Open account", href }],
    });
  });
  return [...items, ...overflow("document-expiring", items.length, total, "expiring document", "/v2/admin/accounts")];
}

export async function shoppingReimbursementItems(): Promise<WorkQueueItem[]> {
  const runs = (await listShoppingRunsForAdmin()).filter((run) => run.cleanerReimbursementStatus === "PENDING_APPROVAL");
  return runs.slice(0, PER_KIND_ROW_CAP).map((run) => {
    const href = links.shoppingRunHref(run.id);
    const amount = run.totals.reimbursableCleanerAmount;
    const receipts = run.payment.receipts?.length ?? 0;
    return row("shopping-reimbursement", {
      id: `shopping:${run.id}`,
      title: `Shopping reimbursement, ${money(amount)}`,
      detail: `${run.ownerName ?? "Cleaner"} · ${run.name} · ${receipts > 0 ? plural(receipts, "receipt") + " attached" : "no receipt attached"}`,
      href,
      actions: [
        { kind: "link", label: "View", href },
        {
          kind: "request", label: "Approve", method: "PATCH", endpoint: `/api/admin/inventory/shopping-runs/${encodeURIComponent(run.id)}`,
          body: { cleanerReimbursementStatus: "READY" }, doneLabel: "Reimbursement approved", primary: true,
        },
      ],
    });
  }).concat(overflow("shopping-reimbursement", Math.min(runs.length, PER_KIND_ROW_CAP), runs.length, "shopping reimbursement", "/v2/admin/inventory"));
}

export async function lostItemItems(ctx: QueueContext): Promise<WorkQueueItem[]> {
  const where = { status: "REPORTED" as const };
  const [total, rows] = await Promise.all([
    db.lostFoundItem.count({ where }),
    db.lostFoundItem.findMany({
      where, orderBy: { createdAt: "desc" }, take: PER_KIND_ROW_CAP,
      select: { id: true, itemName: true, guestName: true, guestContact: true, createdAt: true, property: { select: { name: true } } },
    }),
  ]);
  const items = rows.map((item) => {
    const contact = links.contactHref(item.guestContact);
    const actions: WorkQueueAction[] = [{ kind: "link", label: "Open", href: links.LOST_FOUND_HREF }];
    if (contact) actions.push({ kind: "link", label: "Contact guest", href: contact, external: true, primary: true });
    return row("lost-item", {
      id: `lost:${item.id}`,
      title: `Lost item reported: ${item.itemName}`,
      detail: [item.property?.name, item.guestName ? `guest ${item.guestName}` : "guest not recorded", `reported ${formatInTimeZone(item.createdAt, ctx.timeZone, "d MMM")}`].filter(Boolean).join(" · "),
      href: links.LOST_FOUND_HREF,
      actions,
    });
  });
  return [...items, ...overflow("lost-item", items.length, total, "reported item", links.LOST_FOUND_HREF)];
}
