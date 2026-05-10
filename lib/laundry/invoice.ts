import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

export type LaundryInvoicePeriod = "daily" | "weekly" | "monthly" | "annual" | "custom";

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
}

function parseMeta(notes: string | null | undefined): any {
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch {
    return null;
  }
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function startOfWeekMonday(d: Date) {
  const current = startOfDay(d);
  const day = current.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  current.setDate(current.getDate() + diff);
  return current;
}

function resolveRange(input: LaundryInvoiceQueryInput): {
  period: LaundryInvoicePeriod;
  start: Date;
  end: Date;
} {
  const period = input.period ?? "weekly";
  const anchor = input.anchorDate ? new Date(`${input.anchorDate}T00:00:00`) : new Date();
  const safeAnchor = Number.isNaN(anchor.getTime()) ? new Date() : anchor;

  if (period === "annual") {
    const start = new Date(safeAnchor.getFullYear(), 0, 1, 0, 0, 0, 0);
    const end = new Date(safeAnchor.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { period, start, end };
  }

  if (period === "custom") {
    const start = input.startDate ? new Date(`${input.startDate}T00:00:00`) : startOfWeekMonday(new Date());
    const end = input.endDate ? new Date(`${input.endDate}T23:59:59.999`) : endOfDay(new Date());
    return {
      period,
      start: Number.isNaN(start.getTime()) ? startOfWeekMonday(new Date()) : start,
      end: Number.isNaN(end.getTime()) ? endOfDay(new Date()) : end,
    };
  }

  if (period === "daily") {
    return { period, start: startOfDay(safeAnchor), end: endOfDay(safeAnchor) };
  }

  if (period === "monthly") {
    const start = new Date(safeAnchor.getFullYear(), safeAnchor.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(safeAnchor.getFullYear(), safeAnchor.getMonth() + 1, 0, 23, 59, 59, 999);
    return { period, start, end };
  }

  const weekStart = startOfWeekMonday(safeAnchor);
  const weekEnd = new Date(weekStart.getTime());
  weekEnd.setDate(weekEnd.getDate() + 6);
  return { period: "weekly", start: weekStart, end: endOfDay(weekEnd) };
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

export async function getLaundryInvoiceData(input: LaundryInvoiceQueryInput): Promise<LaundryInvoiceData> {
  const { period, start, end } = resolveRange(input);

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
          ...(input.includePending
            ? {
                OR: [
                  { droppedAt: { gte: start, lte: end } },
                  { pickupDate: { gte: start, lte: end } },
                  { dropoffDate: { gte: start, lte: end } },
                ],
              }
            : {
                droppedAt: { gte: start, lte: end },
              }),
          ...(input.propertyId ? { propertyId: input.propertyId } : {}),
        },
        include: {
          property: { select: { id: true, name: true, suburb: true } },
          job: { select: { id: true, scheduledDate: true } },
          confirmations: { orderBy: { createdAt: "asc" } },
        },
        orderBy: [{ droppedAt: "asc" }],
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
    const amount =
      typeof droppedMeta?.totalPrice === "number" && Number.isFinite(droppedMeta.totalPrice)
        ? Number(droppedMeta.totalPrice)
        : 0;

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
  }

  return {
    period,
    start,
    end,
    propertyId: input.propertyId,
    propertyName,
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

  const rowsHtml = data.rows
    .map((row) => {
      const serviceDate = new Date(row.serviceDate).toLocaleDateString("en-AU");
      const pickupDate = new Date(row.pickupDate).toLocaleDateString("en-AU");
      const dropoffDate = new Date(row.dropoffDate).toLocaleDateString("en-AU");
      return `
      <tr>
        <td class="cell">${escapeHtml(row.propertyName)}</td>
        <td class="cell">${escapeHtml(row.suburb)}</td>
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
    })
    .join("");

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

  const scopeLabel = data.propertyName ? `Property: ${data.propertyName}` : "All properties";
  const periodLabel = `${data.start.toLocaleDateString("en-AU")} - ${data.end.toLocaleDateString("en-AU")}`;

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
        .footer { margin-top: 24px; font-size: 12px; color: #6b7280; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1 class="title">${escapeHtml(template.companyName)}</h1>
          <p class="sub">${escapeHtml(template.invoiceTitle)}</p>
          <p class="sub">${escapeHtml(scopeLabel)}</p>
          <p class="sub">Period: ${escapeHtml(periodLabel)}</p>
        </div>
        <div class="muted" style="font-size:12px;text-align:right;">
          <div><strong>Generated:</strong> ${new Date().toLocaleString("en-AU")}</div>
          <div><strong>Jobs:</strong> ${data.rows.length}</div>
        </div>
      </div>

      <div class="summary">
        <div class="tile"><div class="label">Properties</div><div class="value">${data.propertyBreakdown.length}</div></div>
        <div class="tile"><div class="label">Jobs</div><div class="value">${data.rows.length}</div></div>
        <div class="tile"><div class="label">Period</div><div class="value">${escapeHtml(data.period)}</div></div>
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
          <tbody>${rowsHtml || `<tr><td class="cell" colspan="10">No jobs found for selected period.</td></tr>`}</tbody>
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
