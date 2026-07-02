import { LaundryStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import {
  sydneyDayStart,
  sydneyDayEndInclusive,
  sydneyTodayKey,
  weekMondayKey,
  monthStartKey,
  monthEndKey,
  yearStartKey,
  yearEndKey,
  addDaysToKey,
} from "@/lib/time/sydney-range";

export type LaundryInvoicePeriod = "daily" | "weekly" | "monthly" | "annual" | "custom";

/** Which timestamp the selected date range is applied against. */
export type LaundryDateField = "scheduled" | "confirmed" | "pickup" | "dropped";

const ALL_LAUNDRY_STATUSES: LaundryStatus[] = [
  LaundryStatus.PENDING,
  LaundryStatus.CONFIRMED,
  LaundryStatus.PICKED_UP,
  LaundryStatus.DROPPED,
  LaundryStatus.FLAGGED,
  LaundryStatus.SKIPPED_PICKUP,
];

const DATE_FIELD_LABELS: Record<LaundryDateField, string> = {
  scheduled: "Scheduled date",
  confirmed: "Confirmed date",
  pickup: "Pickup date",
  dropped: "Drop-off date",
};

const STATUS_LABELS: Record<LaundryStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PICKED_UP: "Picked up",
  DROPPED: "Dropped off",
  FLAGGED: "Flagged",
  SKIPPED_PICKUP: "Skipped pickup",
};

export function laundryStatusLabel(status: string): string {
  return STATUS_LABELS[status as LaundryStatus] ?? status;
}

/**
 * Canonical laundry billing amount for a task. Prefer the drop-off confirmation
 * meta price, fall back to the stored dropoffCostAud column. Shared by the
 * invoice/report module and the finance summary so the two can never disagree
 * on a task's dollar value (they used to diverge when only the column was set).
 */
export function laundryTaskAmount(
  droppedMeta: any,
  dropoffCostAud: number | null | undefined
): number {
  if (typeof droppedMeta?.totalPrice === "number" && Number.isFinite(droppedMeta.totalPrice)) {
    return Number(droppedMeta.totalPrice);
  }
  if (typeof dropoffCostAud === "number" && Number.isFinite(dropoffCostAud)) {
    return Number(dropoffCostAud);
  }
  return 0;
}

export interface LaundryInvoiceTemplate {
  companyName: string;
  invoiceTitle: string;
  footerNote: string;
}

export interface LaundryInvoiceRow {
  taskId: string;
  jobId: string;
  propertyId: string;
  propertyName: string;
  suburb: string;
  serviceDate: string;
  pickupDate: string;
  dropoffDate: string;
  droppedAt: string;
  bagCount: number | null;
  dropoffLocation: string | null;
  amount: number;
  notes: string | null;
  status: string;
  cleanerPhotoUrl: string | null;
  pickupPhotoUrl: string | null;
  dropoffPhotoUrl: string | null;
  earlyDropoffReason: string | null;
  intendedDropoffDate: string | null;
}

export interface LaundryInvoiceData {
  period: LaundryInvoicePeriod;
  start: Date;
  end: Date;
  propertyId?: string;
  propertyName?: string | null;
  clientName?: string | null;
  dateField: LaundryDateField;
  dateFieldLabel: string;
  statusLabel: string;
  groupByProperty: boolean;
  rows: LaundryInvoiceRow[];
  totalAmount: number;
  propertyBreakdown: Array<{ propertyId: string; propertyName: string; suburb: string; jobs: number; amount: number }>;
}

interface LaundryInvoiceQueryInput {
  period?: LaundryInvoicePeriod;
  anchorDate?: string;
  startDate?: string;
  endDate?: string;
  propertyId?: string;
  taskId?: string;
  includePending?: boolean;
  /** Filter to properties owned by this client. */
  clientId?: string;
  /** Restrict to a specific set of properties. */
  propertyIds?: string[];
  /** Which statuses to include. Omitted / empty = all statuses. */
  statuses?: LaundryStatus[];
  /** Which timestamp the date range is measured against. Defaults to "dropped". */
  dateField?: LaundryDateField;
  /** Presentation hint: group the job table by property with subtotals. */
  groupByProperty?: boolean;
}

function parseMeta(notes: string | null | undefined): any {
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch {
    return null;
  }
}

/** Valid yyyy-MM-dd? (the routes validate via zod, but be defensive.) */
function isDateKey(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function resolveRange(input: LaundryInvoiceQueryInput): {
  period: LaundryInvoicePeriod;
  start: Date;
  end: Date;
} {
  const period = input.period ?? "weekly";
  // Anchor on a Sydney calendar day so period boundaries line up with the
  // Sydney-rendered dates and with finance (see lib/time/sydney-range).
  const anchorKey = isDateKey(input.anchorDate) ? input.anchorDate : sydneyTodayKey();

  if (period === "annual") {
    return {
      period,
      start: sydneyDayStart(yearStartKey(anchorKey)),
      end: sydneyDayEndInclusive(yearEndKey(anchorKey)),
    };
  }

  if (period === "custom") {
    const startKey = isDateKey(input.startDate) ? input.startDate : weekMondayKey(sydneyTodayKey());
    const endKey = isDateKey(input.endDate) ? input.endDate : sydneyTodayKey();
    return { period, start: sydneyDayStart(startKey), end: sydneyDayEndInclusive(endKey) };
  }

  if (period === "daily") {
    return { period, start: sydneyDayStart(anchorKey), end: sydneyDayEndInclusive(anchorKey) };
  }

  if (period === "monthly") {
    return {
      period,
      start: sydneyDayStart(monthStartKey(anchorKey)),
      end: sydneyDayEndInclusive(monthEndKey(anchorKey)),
    };
  }

  const weekStartKey = weekMondayKey(anchorKey);
  const weekEndKey = addDaysToKey(weekStartKey, 6);
  return { period: "weekly", start: sydneyDayStart(weekStartKey), end: sydneyDayEndInclusive(weekEndKey) };
}

function defaultTemplate(companyName: string): LaundryInvoiceTemplate {
  return {
    companyName,
    invoiceTitle: "Laundry Services Invoice",
    footerNote: "Thank you for your services.",
  };
}

function templateKeyForUser(userId: string) {
  return `laundry_invoice_template:${userId}`;
}

export async function getLaundryInvoiceTemplate(userId: string): Promise<LaundryInvoiceTemplate> {
  const settings = await getAppSettings();
  const fallback = defaultTemplate(settings.companyName);
  const row = await db.appSetting.findUnique({
    where: { key: templateKeyForUser(userId) },
  });
  if (!row || !row.value || typeof row.value !== "object") return fallback;
  const value = row.value as Record<string, unknown>;
  return {
    companyName:
      typeof value.companyName === "string" && value.companyName.trim()
        ? value.companyName.trim()
        : fallback.companyName,
    invoiceTitle:
      typeof value.invoiceTitle === "string" && value.invoiceTitle.trim()
        ? value.invoiceTitle.trim()
        : fallback.invoiceTitle,
    footerNote:
      typeof value.footerNote === "string" ? value.footerNote.trim() : fallback.footerNote,
  };
}

export async function saveLaundryInvoiceTemplate(
  userId: string,
  input: Partial<LaundryInvoiceTemplate>
): Promise<LaundryInvoiceTemplate> {
  const current = await getLaundryInvoiceTemplate(userId);
  const next: LaundryInvoiceTemplate = {
    companyName: input.companyName?.trim() || current.companyName,
    invoiceTitle: input.invoiceTitle?.trim() || current.invoiceTitle,
    footerNote:
      input.footerNote !== undefined ? input.footerNote.trim() : current.footerNote,
  };
  await db.appSetting.upsert({
    where: { key: templateKeyForUser(userId) },
    create: { key: templateKeyForUser(userId), value: next as any },
    update: { value: next as any },
  });
  return next;
}

function buildDateRangeWhere(
  input: LaundryInvoiceQueryInput,
  start: Date,
  end: Date
): Prisma.LaundryTaskWhereInput {
  // Explicit date-field selection takes precedence and gives deterministic ranges.
  if (input.dateField) {
    switch (input.dateField) {
      case "scheduled":
        return { job: { scheduledDate: { gte: start, lte: end } } };
      case "confirmed":
        return { confirmedAt: { gte: start, lte: end } };
      case "pickup":
        return { pickedUpAt: { gte: start, lte: end } };
      case "dropped":
      default:
        return { droppedAt: { gte: start, lte: end } };
    }
  }
  // Legacy behaviour: pending-inclusive OR across timestamps, else completed-only.
  return input.includePending
    ? {
        OR: [
          { droppedAt: { gte: start, lte: end } },
          { pickupDate: { gte: start, lte: end } },
          { dropoffDate: { gte: start, lte: end } },
        ],
      }
    : { droppedAt: { gte: start, lte: end } };
}

export async function getLaundryInvoiceData(input: LaundryInvoiceQueryInput): Promise<LaundryInvoiceData> {
  const { period, start, end } = resolveRange(input);
  const dateField: LaundryDateField = input.dateField ?? "dropped";

  const requestedStatuses =
    input.statuses && input.statuses.length > 0
      ? input.statuses.filter((s) => ALL_LAUNDRY_STATUSES.includes(s))
      : null;

  const propertyIds =
    input.propertyIds && input.propertyIds.length > 0
      ? Array.from(new Set(input.propertyIds.filter((id) => typeof id === "string" && id.trim())))
      : null;

  const scopeWhere: Prisma.LaundryTaskWhereInput = {};
  if (input.propertyId) {
    scopeWhere.propertyId = input.propertyId;
  } else if (propertyIds) {
    scopeWhere.propertyId = { in: propertyIds };
  }
  if (input.clientId) {
    scopeWhere.property = { clientId: input.clientId };
  }
  if (requestedStatuses) {
    scopeWhere.status = { in: requestedStatuses };
  }

  const orderField =
    dateField === "scheduled"
      ? undefined // ordered client-side by service date
      : dateField === "confirmed"
        ? { confirmedAt: "asc" as const }
        : dateField === "pickup"
          ? { pickedUpAt: "asc" as const }
          : { droppedAt: "asc" as const };

  const tasks = input.taskId
    ? await db.laundryTask.findMany({
        where: { id: input.taskId },
        include: {
          property: { select: { id: true, name: true, suburb: true } },
          job: { select: { id: true, scheduledDate: true } },
          confirmations: { orderBy: { createdAt: "asc" } },
        },
        take: 1,
      })
    : await db.laundryTask.findMany({
        where: {
          ...buildDateRangeWhere(input, start, end),
          ...scopeWhere,
        },
        include: {
          property: { select: { id: true, name: true, suburb: true } },
          job: { select: { id: true, scheduledDate: true } },
          confirmations: { orderBy: { createdAt: "asc" } },
        },
        orderBy: orderField ?? undefined,
      });

  const rows: LaundryInvoiceRow[] = tasks.map((task) => {
    const cleanerConfirmation =
      task.confirmations.find((c) => {
        const meta = parseMeta(c.notes);
        return c.laundryReady === true && Boolean(c.photoUrl) && !meta?.event;
      }) ?? null;
    const pickedUpConfirmation = task.confirmations.find((c) => parseMeta(c.notes)?.event === "PICKED_UP");
    const droppedConfirmation =
      [...task.confirmations].reverse().find((c) => parseMeta(c.notes)?.event === "DROPPED") ?? null;
    const pickedMeta = parseMeta(pickedUpConfirmation?.notes);
    const droppedMeta = parseMeta(droppedConfirmation?.notes);
    // Prefer the confirmation-meta price, but fall back to the canonical
    // dropoffCostAud column so previews, downloads and emails never disagree
    // when the meta happens to be missing.
    const amount = laundryTaskAmount(droppedMeta, task.dropoffCostAud);

    return {
      taskId: task.id,
      jobId: task.job.id,
      propertyId: task.property.id,
      propertyName: task.property.name,
      suburb: task.property.suburb,
      serviceDate: task.job.scheduledDate.toISOString(),
      pickupDate: task.pickupDate.toISOString(),
      dropoffDate: task.dropoffDate.toISOString(),
      droppedAt: (task.droppedAt ?? droppedConfirmation?.createdAt ?? task.updatedAt).toISOString(),
      bagCount:
        typeof pickedMeta?.bagCount === "number" && Number.isFinite(pickedMeta.bagCount)
          ? Math.round(pickedMeta.bagCount)
          : // Admin evidence path stores bagCount on the DROPPED-event meta when a
            // task never had a separate PICKED_UP confirmation.
            typeof droppedMeta?.bagCount === "number" && Number.isFinite(droppedMeta.bagCount)
            ? Math.round(droppedMeta.bagCount)
            : null,
      dropoffLocation:
        (typeof droppedMeta?.dropoffLocation === "string" && droppedMeta.dropoffLocation.trim()) ||
        droppedConfirmation?.bagLocation ||
        null,
      amount,
      notes:
        (typeof droppedMeta?.notes === "string" && droppedMeta.notes.trim()) ||
        (typeof task.flagNotes === "string" && task.flagNotes.trim()) ||
        null,
      status: task.status,
      cleanerPhotoUrl: cleanerConfirmation?.photoUrl ?? null,
      pickupPhotoUrl: pickedUpConfirmation?.photoUrl ?? null,
      dropoffPhotoUrl: droppedConfirmation?.photoUrl ?? null,
      earlyDropoffReason:
        typeof droppedMeta?.earlyDropoffReason === "string" && droppedMeta.earlyDropoffReason.trim()
          ? droppedMeta.earlyDropoffReason.trim()
          : null,
      intendedDropoffDate:
        typeof droppedMeta?.intendedDropoffDate === "string" && droppedMeta.intendedDropoffDate
          ? droppedMeta.intendedDropoffDate
          : null,
    };
  });

  // "scheduled" range can't be ordered in Prisma via a scalar column, so sort here.
  if (dateField === "scheduled") {
    rows.sort((a, b) => new Date(a.serviceDate).getTime() - new Date(b.serviceDate).getTime());
  }

  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);

  const byProperty = new Map<string, { propertyId: string; propertyName: string; suburb: string; jobs: number; amount: number }>();
  for (const row of rows) {
    const current = byProperty.get(row.propertyId) ?? {
      propertyId: row.propertyId,
      propertyName: row.propertyName,
      suburb: row.suburb,
      jobs: 0,
      amount: 0,
    };
    current.jobs += 1;
    current.amount += row.amount;
    byProperty.set(row.propertyId, current);
  }

  const propertyBreakdown = Array.from(byProperty.values()).sort((a, b) =>
    a.propertyName.localeCompare(b.propertyName)
  );

  let propertyName: string | null = null;
  if (input.taskId && rows.length === 1) {
    propertyName = rows[0].propertyName;
  } else if (input.propertyId) {
    const property = await db.property.findUnique({
      where: { id: input.propertyId },
      select: { name: true },
    });
    propertyName = property?.name ?? null;
  } else if (propertyIds && propertyIds.length === 1) {
    propertyName = propertyBreakdown[0]?.propertyName ?? null;
  }

  let clientName: string | null = null;
  if (input.clientId) {
    const client = await db.client.findUnique({
      where: { id: input.clientId },
      select: { name: true },
    });
    clientName = client?.name ?? null;
  }

  const statusLabel = requestedStatuses
    ? requestedStatuses.map((s) => STATUS_LABELS[s]).join(", ")
    : "All statuses";

  return {
    period,
    start,
    end,
    propertyId: input.propertyId,
    propertyName,
    clientName,
    dateField,
    dateFieldLabel: DATE_FIELD_LABELS[dateField],
    statusLabel,
    groupByProperty: input.groupByProperty === true,
    rows,
    totalAmount,
    propertyBreakdown,
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export function buildLaundryInvoiceHtml(args: {
  data: LaundryInvoiceData;
  template: LaundryInvoiceTemplate;
}) {
  const { data, template } = args;

  const JOB_TABLE_COLSPAN = 11;

  const renderRow = (row: LaundryInvoiceRow): string => {
    const serviceDate = new Date(row.serviceDate).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" });
    const pickupDate = new Date(row.pickupDate).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" });
    const dropoffDate = new Date(row.dropoffDate).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" });
    return `
      <tr>
        <td class="cell">${escapeHtml(row.propertyName)}</td>
        <td class="cell">${escapeHtml(row.suburb)}</td>
        <td class="cell">${escapeHtml(laundryStatusLabel(row.status))}</td>
        <td class="cell">${serviceDate}</td>
        <td class="cell">${pickupDate}</td>
        <td class="cell">${dropoffDate}</td>
        <td class="cell right">${row.bagCount ?? "-"}</td>
        <td class="cell">${escapeHtml(row.dropoffLocation ?? "-")}</td>
        <td class="cell">${escapeHtml(row.notes ?? "-")}</td>
        <td class="cell">
          ${
            row.cleanerPhotoUrl || row.pickupPhotoUrl || row.dropoffPhotoUrl
              ? `
                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  ${
                    row.cleanerPhotoUrl
                      ? `<div><div class="muted" style="font-size:10px;">Cleaner</div><img src="${escapeHtml(row.cleanerPhotoUrl)}" style="height:52px;width:52px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" /></div>`
                      : ""
                  }
                  ${
                    row.pickupPhotoUrl
                      ? `<div><div class="muted" style="font-size:10px;">Pickup</div><img src="${escapeHtml(row.pickupPhotoUrl)}" style="height:52px;width:52px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" /></div>`
                      : ""
                  }
                  ${
                    row.dropoffPhotoUrl
                      ? `<div><div class="muted" style="font-size:10px;">Drop-off</div><img src="${escapeHtml(row.dropoffPhotoUrl)}" style="height:52px;width:52px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" /></div>`
                      : ""
                  }
                </div>
              `
              : "-"
          }
          ${
            row.earlyDropoffReason
              ? `<div class="muted" style="font-size:10px;margin-top:4px;">Early return: ${escapeHtml(row.earlyDropoffReason)}</div>`
              : ""
          }
        </td>
        <td class="cell right">${money(row.amount)}</td>
      </tr>
      `;
  };

  let rowsHtml: string;
  if (data.groupByProperty && data.rows.length > 0) {
    // Group rows by property, each group ending with a subtotal, then a grand total.
    const groups = new Map<string, LaundryInvoiceRow[]>();
    for (const row of data.rows) {
      const list = groups.get(row.propertyId) ?? [];
      list.push(row);
      groups.set(row.propertyId, list);
    }
    const orderedGroups = Array.from(groups.values()).sort((a, b) =>
      a[0].propertyName.localeCompare(b[0].propertyName)
    );
    rowsHtml = orderedGroups
      .map((groupRows) => {
        const subtotal = groupRows.reduce((sum, r) => sum + r.amount, 0);
        const header = `
          <tr>
            <td class="cell group-head" colspan="${JOB_TABLE_COLSPAN}">
              ${escapeHtml(groupRows[0].propertyName)}
              <span class="muted" style="font-weight:400;">· ${escapeHtml(groupRows[0].suburb)} · ${groupRows.length} job${groupRows.length === 1 ? "" : "s"}</span>
            </td>
          </tr>`;
        const body = groupRows.map(renderRow).join("");
        const footer = `
          <tr>
            <td class="cell subtotal" colspan="${JOB_TABLE_COLSPAN - 1}">Subtotal — ${escapeHtml(groupRows[0].propertyName)}</td>
            <td class="cell subtotal right">${money(subtotal)}</td>
          </tr>`;
        return header + body + footer;
      })
      .join("");
    rowsHtml += `
      <tr>
        <td class="cell grand" colspan="${JOB_TABLE_COLSPAN - 1}">Grand total</td>
        <td class="cell grand right">${money(data.totalAmount)}</td>
      </tr>`;
  } else {
    rowsHtml = data.rows.map(renderRow).join("");
    if (data.rows.length > 0) {
      rowsHtml += `
        <tr>
          <td class="cell grand" colspan="${JOB_TABLE_COLSPAN - 1}">Total</td>
          <td class="cell grand right">${money(data.totalAmount)}</td>
        </tr>`;
    }
  }

  const breakdownHtml = data.propertyBreakdown
    .map(
      (item) => `
      <tr>
        <td class="cell">${escapeHtml(item.propertyName)}</td>
        <td class="cell">${escapeHtml(item.suburb)}</td>
        <td class="cell right">${item.jobs}</td>
        <td class="cell right">${money(item.amount)}</td>
      </tr>
    `
    )
    .join("");

  const scopeLabel = data.clientName
    ? `Client: ${data.clientName}${data.propertyName ? ` · ${data.propertyName}` : ""}`
    : data.propertyName
      ? `Property: ${data.propertyName}`
      : "All properties";
  const periodLabel = `${data.start.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })} - ${data.end.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })}`;

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(template.companyName)} - Laundry Invoice</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111827; margin: 20px; }
        .header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
        .title { margin: 0; font-size: 22px; }
        .sub { margin: 4px 0 0; color: #6b7280; font-size: 12px; }
        .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }
        .tile { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
        .label { font-size: 10px; color: #6b7280; text-transform: uppercase; }
        .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
        .section { margin-top: 18px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { text-align: left; border-bottom: 2px solid #d1d5db; padding: 8px; }
        .cell { border-bottom: 1px solid #e5e7eb; padding: 8px; vertical-align: top; }
        .right { text-align: right; white-space: nowrap; }
        .muted { color: #6b7280; }
        .group-head { background: #f3f4f6; font-weight: 700; font-size: 12px; }
        .subtotal { background: #fafafa; font-weight: 600; }
        .grand { background: #111827; color: #ffffff; font-weight: 700; }
        .footer { margin-top: 24px; font-size: 12px; color: #6b7280; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1 class="title">${escapeHtml(template.companyName)}</h1>
          <p class="sub">${escapeHtml(template.invoiceTitle)}</p>
          <p class="sub">${escapeHtml(scopeLabel)}</p>
          <p class="sub">Period (${escapeHtml(data.dateFieldLabel)}): ${escapeHtml(periodLabel)}</p>
          <p class="sub">Statuses: ${escapeHtml(data.statusLabel)}</p>
        </div>
        <div class="muted" style="font-size:12px;text-align:right;">
          <div><strong>Generated:</strong> ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}</div>
          <div><strong>Jobs:</strong> ${data.rows.length}</div>
        </div>
      </div>

      <div class="summary">
        <div class="tile"><div class="label">Properties</div><div class="value">${data.propertyBreakdown.length}</div></div>
        <div class="tile"><div class="label">Jobs</div><div class="value">${data.rows.length}</div></div>
        <div class="tile"><div class="label">Date basis</div><div class="value" style="font-size:13px;">${escapeHtml(data.dateFieldLabel)}</div></div>
        <div class="tile"><div class="label">Total</div><div class="value">${money(data.totalAmount)}</div></div>
      </div>

      <div class="section">
        <h3 style="margin:0 0 8px;">Property Breakdown</h3>
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Suburb</th>
              <th class="right">Jobs</th>
              <th class="right">Amount</th>
            </tr>
          </thead>
          <tbody>${breakdownHtml || `<tr><td class="cell" colspan="4">No completed laundry returns in selected period.</td></tr>`}</tbody>
        </table>
      </div>

      <div class="section">
        <h3 style="margin:0 0 8px;">Job Breakdown</h3>
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Suburb</th>
              <th>Status</th>
              <th>Service Date</th>
              <th>Pickup</th>
              <th>Return</th>
              <th class="right">Bags</th>
              <th>Drop-off Location</th>
              <th>Notes</th>
              <th>Evidence</th>
              <th class="right">Amount</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td class="cell" colspan="11">No jobs found for selected period.</td></tr>`}</tbody>
        </table>
      </div>

      <div class="footer">
        ${escapeHtml(template.footerNote || "")}
      </div>
    </body>
  </html>`;
}

export async function renderLaundryInvoicePdf(html: string): Promise<Buffer> {
  const { renderPdfFromHtml } = await import("@/lib/reports/pdf");
  return renderPdfFromHtml(html, "laundry invoice PDF generation", {
    margin: { top: "12mm", right: "8mm", bottom: "12mm", left: "8mm" },
  });
}
