import { randomUUID } from "crypto";
import { ClientInvoiceStatus, JobStatus, JobType } from "@prisma/client";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { renderPdfFromHtml } from "@/lib/reports/pdf";
import { publicUrl } from "@/lib/s3";
import { getAppSettings } from "@/lib/settings";
import { calculateGstBreakdown } from "@/lib/pricing/gst";
import { computeClientCharge } from "@/lib/finance/job-money";

/**
 * Jobs eligible to be billed on a client invoice: any job that has actually
 * started or finished. We deliberately exclude not-yet-started jobs
 * (UNASSIGNED/OFFERED) — there's nothing to bill yet — and skipped cleans are
 * filtered separately via cleanSkipStatus. (There is no CANCELLED status in the
 * Job model.) This lets admins bill unfinished/in-progress work, not just
 * COMPLETED/INVOICED jobs.
 */
export const BILLABLE_JOB_STATUSES: JobStatus[] = [
  JobStatus.ASSIGNED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
  JobStatus.COMPLETED,
  JobStatus.INVOICED,
];

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function listInvoiceContext() {
  const [clients, properties, rates, invoices] = await Promise.all([
    db.client.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, properties: { select: { id: true, name: true } } },
      orderBy: [{ name: "asc" }],
    }),
    db.property.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        suburb: true,
        clientId: true,
        client: { select: { name: true } },
      },
      orderBy: [{ name: "asc" }],
    }),
    db.propertyClientRate.findMany({
      include: {
        property: { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } },
      },
      orderBy: [{ property: { name: "asc" } }, { jobType: "asc" }],
    }),
    db.clientInvoice.findMany({
      include: {
        client: { select: { id: true, name: true, email: true } },
        lines: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    }),
  ]);
  return { clients, properties, rates, invoices };
}

export async function upsertPropertyClientRate(input: {
  propertyId: string;
  jobType: JobType;
  baseCharge: number;
  billingUnit?: string;
  defaultDescription?: string | null;
  isActive?: boolean;
}) {
  return db.propertyClientRate.upsert({
    where: { propertyId_jobType: { propertyId: input.propertyId, jobType: input.jobType } },
    create: {
      propertyId: input.propertyId,
      jobType: input.jobType,
      baseCharge: input.baseCharge,
      billingUnit: input.billingUnit?.trim() || "PER_JOB",
      defaultDescription: input.defaultDescription?.trim() || null,
      isActive: input.isActive ?? true,
    },
    update: {
      baseCharge: input.baseCharge,
      billingUnit: input.billingUnit?.trim() || "PER_JOB",
      defaultDescription: input.defaultDescription?.trim() || null,
      isActive: input.isActive ?? true,
    },
    include: {
      property: { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } },
    },
  });
}

async function nextInvoiceNumber() {
  const datePart = format(new Date(), "yyyyMMdd");
  return `INV-${datePart}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function generateClientInvoice(input: {
  clientId: string;
  propertyId?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  gstEnabled?: boolean;
}) {
  const [client, rates, existingInvoiced, settings, priceBook] = await Promise.all([
    db.client.findUnique({ where: { id: input.clientId }, select: { id: true, name: true, email: true } }),
    db.propertyClientRate.findMany({
      where: {
        property: { clientId: input.clientId },
        ...(input.propertyId ? { propertyId: input.propertyId } : {}),
        isActive: true,
      },
    }),
    db.clientInvoiceLine.findMany({
      where: {
        jobId: { not: null },
        // Scope to THIS client — avoid scanning every invoice line for every client.
        invoice: { status: { not: ClientInvoiceStatus.VOID }, clientId: input.clientId },
      },
      select: { jobId: true },
    }),
    getAppSettings(),
    db.priceBook.findMany({
      where: { isActive: true },
      select: { jobType: true, baseRate: true },
    }),
  ]);
  if (!client) {
    throw new Error("Client not found.");
  }

  const invoicedJobIds = new Set(existingInvoiced.map((row) => row.jobId).filter((value): value is string => Boolean(value)));
  const propertyRates = rates.map((rate) => ({
    propertyId: rate.propertyId,
    jobType: rate.jobType,
    baseCharge: rate.baseCharge,
    defaultDescription: rate.defaultDescription,
  }));

  const jobs = await db.job.findMany({
    where: {
      property: {
        clientId: input.clientId,
        ...(input.propertyId ? { id: input.propertyId } : {}),
      },
      status: { in: BILLABLE_JOB_STATUSES },
      // Skipped cleans ("don't clean this turnover") are never billed.
      cleanSkipStatus: { not: "SKIPPED" },
      ...(input.periodStart || input.periodEnd
        ? {
            // Bucket by completion date when set (next-day/custom), else scheduled date.
            OR: [
              {
                completedAt: {
                  ...(input.periodStart ? { gte: input.periodStart } : {}),
                  ...(input.periodEnd ? { lte: input.periodEnd } : {}),
                },
              },
              {
                completedAt: null,
                scheduledDate: {
                  ...(input.periodStart ? { gte: input.periodStart } : {}),
                  ...(input.periodEnd ? { lte: input.periodEnd } : {}),
                },
              },
            ],
          }
        : {}),
    },
    include: {
      property: { select: { id: true, name: true, suburb: true } },
    },
    orderBy: [{ scheduledDate: "asc" }],
  });

  const unInvoicedJobs = jobs.filter((job) => !invoicedJobIds.has(job.id));

  // Canonical client charge per job (fixed job price → property rate → job-type
  // price). Compute once and reuse for both the missing-rate guard and the lines,
  // so the invoice can never silently drop a job that DID have a resolvable charge.
  const chargeByJob = new Map(
    unInvoicedJobs.map((job) => [
      job.id,
      computeClientCharge(
        { jobType: job.jobType, propertyId: job.propertyId, fixedPrice: job.fixedPrice },
        { propertyRates, priceBook }
      ),
    ])
  );

  // Check for missing rates before silently skipping jobs.
  const missingRateJobs = unInvoicedJobs.filter((job) => chargeByJob.get(job.id)?.rateMissing);
  if (missingRateJobs.length > 0) {
    const details = missingRateJobs
      .map((j) => `${j.jobNumber || j.id} (${j.jobType}) at ${j.property.name}`)
      .join(", ");
    throw new Error(
      `Missing client rates for ${missingRateJobs.length} job(s): ${details}. Set rates in Billing Rates before invoicing.`
    );
  }

  const lines = unInvoicedJobs
    .map((job) => {
      const charge = chargeByJob.get(job.id);
      if (!charge || charge.amount == null) return null;
      // Use the SCHEDULED date in Sydney time (matches the small-print subtitle
      // and the jobs page). completedAt could cross the Sydney midnight boundary
      // and format() used the server timezone, so the big-title date drifted a day.
      const description =
        charge.description?.trim() ||
        `${job.property.name} - ${String(job.jobType).replace(/_/g, " ")} - ${formatInTimeZone(new Date(job.scheduledDate), "Australia/Sydney", "dd MMM yyyy")}`;
      const lineTotal = charge.amount;
      return {
        jobId: job.id,
        shoppingRunId: null,
        description,
        note: job.invoiceNote?.trim() || null,
        quantity: 1,
        unitPrice: lineTotal,
        lineTotal,
        category: "SERVICE",
      };
    })
    .filter(Boolean) as Array<{
    jobId: string;
    shoppingRunId: null;
    description: string;
    note: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    category: string;
  }>;

  const shoppingRuns = await db.shoppingRun.findMany({
    where: {
      settlements: {
        some: {
          clientBillable: true,
          adminApprovedForClient: true,
          includedInClientInvoiceId: null,
        },
      },
      ...(input.periodStart || input.periodEnd
        ? {
            updatedAt: {
              ...(input.periodStart ? { gte: input.periodStart } : {}),
              ...(input.periodEnd ? { lte: input.periodEnd } : {}),
            },
          }
        : {}),
      lines: {
        some: input.propertyId
          ? { propertyId: input.propertyId }
          : { property: { clientId: input.clientId } },
      },
    },
    include: {
      lines: {
        include: {
          property: { select: { id: true, name: true, clientId: true } },
        },
      },
      settlements: {
        where: {
          clientBillable: true,
          adminApprovedForClient: true,
          includedInClientInvoiceId: null,
        },
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "asc" }],
  });

  const shoppingLines = shoppingRuns
    .filter((run) => {
      if (run.lines.length === 0) return false;
      const properties = run.lines.map((line) => line.property);
      if (properties.some((property) => !property || property.clientId !== input.clientId)) return false;
      if (input.propertyId && properties.some((property) => property.id !== input.propertyId)) return false;
      return run.settlements.length > 0;
    })
    .map((run) => {
      const settlement = run.settlements[0];
      const total = Number(
        run.lines.reduce((sum, line) => sum + Number(line.lineCost ?? 0), 0).toFixed(2)
      );
      if (total <= 0) return null;
      return {
        jobId: null,
        shoppingRunId: run.id,
        description: `Shopping reimbursement - ${run.title}`,
        note: null,
        quantity: 1,
        unitPrice: total,
        lineTotal: total,
        category: "SHOPPING_REIMBURSEMENT",
        settlementId: settlement.id,
      };
    })
    .filter(Boolean) as Array<{
      jobId: null;
      shoppingRunId: string;
      description: string;
      note: null;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      category: string;
      settlementId: string;
    }>;

  const allLines = [...lines, ...shoppingLines.map(({ settlementId, ...line }) => line)];

  if (allLines.length === 0) {
    throw new Error("No billable completed jobs found for the selected client and period.");
  }

  const gstFlag = input.gstEnabled ?? settings.pricing.gstEnabled;
  const { subtotal, gstAmount, totalAmount } = calculateGstBreakdown(
    allLines.reduce((sum, line) => sum + line.lineTotal, 0),
    { gstEnabled: gstFlag }
  );

  const invoiceNumber = await nextInvoiceNumber();
  // Atomic: create the invoice (with its lines) AND mark the consumed shopping
  // settlements in one transaction, so a crash can't leave settlements billable
  // again or produce an invoice with orphaned consumption.
  const invoice = await db.$transaction(async (tx) => {
    const created = await tx.clientInvoice.create({
    data: {
      clientId: client.id,
      invoiceNumber,
      status: ClientInvoiceStatus.DRAFT,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      subtotal,
      gstAmount,
      totalAmount,
      gstEnabled: gstFlag,
      metadata: { source: "job-rate-generator", shoppingRunCount: shoppingLines.length },
      lines: { create: allLines },
    },
    include: {
      client: { select: { id: true, name: true, email: true } },
      lines: {
        include: {
          job: {
            select: {
              id: true,
              jobNumber: true,
              scheduledDate: true,
              property: { select: { name: true, suburb: true } },
            },
          },
        },
      },
    },
  });

    if (shoppingLines.length > 0) {
      await tx.shoppingSettlement.updateMany({
        where: { id: { in: shoppingLines.map((line) => line.settlementId) } },
        data: { includedInClientInvoiceId: created.id },
      });
    }

    return created;
  });

  return invoice;
}

export async function getClientInvoice(invoiceId: string) {
  return db.clientInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      client: {
        select: {
          id: true, name: true, email: true, phone: true,
          address: true, suburb: true, state: true, postcode: true,
        },
      },
      lines: {
        include: {
          job: {
            select: {
              id: true,
              jobNumber: true,
              scheduledDate: true,
              property: { select: { name: true, suburb: true } },
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

/** Make a logo value loadable by the server-side PDF renderer: absolute URLs /
 *  data URIs pass through; an S3 key or bare path becomes an absolute URL. */
function resolveInvoiceLogo(raw?: string | null): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (/^(https?:|data:)/i.test(v)) return v;
  try {
    return publicUrl(v.replace(/^\/+/, ""));
  } catch {
    return v;
  }
}

export function buildClientInvoiceHtml(
  invoice: NonNullable<Awaited<ReturnType<typeof getClientInvoice>>>,
  companyName: string,
  logoUrl?: string | null,
  invoicingSettings?: {
    abn?: string;
    companyAddress?: string;
    bankName?: string;
    bankBsb?: string;
    bankAccountNumber?: string;
    bankAccountName?: string;
    paymentNote?: string;
    defaultPaymentTermsDays?: number;
  }
) {
  const linesHtml = invoice.lines
    .map((line) => {
      const meta =
        line.job != null
          ? `${escapeHtml(line.job.property.name)} · ${escapeHtml(line.job.jobNumber || line.job.id)} · ${format(new Date(line.job.scheduledDate), "dd MMM yyyy")}`
          : "";
      return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;">
            <div style="font-weight:600;">${escapeHtml(line.description)}</div>
            ${meta ? `<div style="font-size:12px;color:#6b7280;">${meta}</div>` : ""}
            ${line.note ? `<div style="font-size:12px;color:#374151;margin-top:4px;">${escapeHtml(line.note)}</div>` : ""}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${line.quantity.toFixed(2)}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(line.unitPrice)}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(line.lineTotal)}</td>
        </tr>
      `;
    })
    .join("");

  const gstSummaryHtml =
    Number(invoice.gstAmount ?? 0) > 0
      ? `
          <div style="display:flex;justify-content:space-between;padding:8px 0;">
            <span>GST</span>
            <strong>${money(invoice.gstAmount)}</strong>
          </div>
        `
      : "";

  const termsDays = invoicingSettings?.defaultPaymentTermsDays ?? 14;
  const dueDate = format(
    new Date(new Date(invoice.createdAt).getTime() + termsDays * 86400000),
    "dd MMM yyyy"
  );

  const paymentHtml =
    invoicingSettings?.bankAccountNumber
      ? `
        <div style="margin-top:32px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;">
          <p style="margin:0 0 8px;font-weight:700;font-size:14px;">Payment Details</p>
          ${invoicingSettings.bankName ? `<p style="margin:2px 0;font-size:13px;"><strong>Bank:</strong> ${escapeHtml(invoicingSettings.bankName)}</p>` : ""}
          ${invoicingSettings.bankAccountName ? `<p style="margin:2px 0;font-size:13px;"><strong>Account name:</strong> ${escapeHtml(invoicingSettings.bankAccountName)}</p>` : ""}
          ${invoicingSettings.bankBsb ? `<p style="margin:2px 0;font-size:13px;"><strong>BSB:</strong> ${escapeHtml(invoicingSettings.bankBsb)}</p>` : ""}
          <p style="margin:2px 0;font-size:13px;"><strong>Account number:</strong> ${escapeHtml(invoicingSettings.bankAccountNumber)}</p>
          <p style="margin:2px 0;font-size:13px;"><strong>Reference:</strong> ${escapeHtml(invoice.invoiceNumber)}</p>
          ${invoicingSettings.paymentNote ? `<p style="margin:8px 0 0;font-size:12px;color:#6b7280;">${escapeHtml(invoicingSettings.paymentNote)}</p>` : ""}
        </div>
      `
      : "";

  const logo = resolveInvoiceLogo(logoUrl);
  const c = invoice.client;
  const clientCityLine = [c.suburb, c.state, c.postcode].filter(Boolean).join(" ").trim();

  return `
    <html>
      <body style="font-family:Arial,sans-serif;color:#111827;margin:32px;max-width:800px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;">
          <div>
            ${logo ? `<img src="${logo}" alt="${escapeHtml(companyName)}" style="display:block;height:56px;width:auto;max-width:220px;object-fit:contain;margin-bottom:14px;border:0;" />` : ""}
            <h1 style="margin:0 0 4px;font-size:26px;color:#111827;">${escapeHtml(companyName)}</h1>
            ${invoicingSettings?.abn ? `<p style="margin:2px 0;font-size:12px;color:#6b7280;">ABN: ${escapeHtml(invoicingSettings.abn)}</p>` : ""}
            ${invoicingSettings?.companyAddress ? `<p style="margin:2px 0;font-size:12px;color:#6b7280;">${escapeHtml(invoicingSettings.companyAddress)}</p>` : ""}
          </div>
          <div style="text-align:right;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#111827;">TAX INVOICE</p>
            <p style="margin:4px 0 0;font-size:14px;"><strong>${escapeHtml(invoice.invoiceNumber)}</strong></p>
            <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Date: ${format(new Date(invoice.createdAt), "dd MMM yyyy")}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Due: ${dueDate}</p>
            <p style="margin:6px 0 0;display:inline-block;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:700;background:${invoice.status === "PAID" ? "#d1fae5" : invoice.status === "SENT" ? "#dbeafe" : "#fef3c7"};color:${invoice.status === "PAID" ? "#065f46" : invoice.status === "SENT" ? "#1e40af" : "#92400e"};">${escapeHtml(invoice.status)}</p>
          </div>
        </div>

        <div style="margin-bottom:28px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;color:#6b7280;letter-spacing:0.05em;">Bill To</p>
          <p style="margin:0;font-weight:700;font-size:16px;">${escapeHtml(c.name)}</p>
          ${c.address ? `<p style="margin:2px 0 0;font-size:13px;color:#374151;">${escapeHtml(c.address)}</p>` : ""}
          ${clientCityLine ? `<p style="margin:1px 0 0;font-size:13px;color:#374151;">${escapeHtml(clientCityLine)}</p>` : ""}
          ${c.phone ? `<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${escapeHtml(c.phone)}</p>` : ""}
          ${c.email ? `<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${escapeHtml(c.email)}</p>` : ""}
          ${invoice.periodStart && invoice.periodEnd ? `<p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Service period: ${format(new Date(invoice.periodStart), "dd MMM yyyy")} – ${format(new Date(invoice.periodEnd), "dd MMM yyyy")}</p>` : ""}
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #111827;font-size:13px;">Description</th>
              <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #111827;font-size:13px;">Qty</th>
              <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #111827;font-size:13px;">Rate</th>
              <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #111827;font-size:13px;">Total</th>
            </tr>
          </thead>
          <tbody>${linesHtml}</tbody>
        </table>

        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <div style="min-width:280px;">
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid #e5e7eb;">
              <span style="color:#6b7280;">Subtotal</span>
              <strong>${money(invoice.subtotal)}</strong>
            </div>
            ${gstSummaryHtml}
            <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:2px solid #111827;font-size:18px;">
              <span><strong>Total (AUD)</strong></span>
              <strong>${money(invoice.totalAmount)}</strong>
            </div>
          </div>
        </div>

        ${paymentHtml}
      </body>
    </html>
  `;
}

export async function renderClientInvoicePdf(
  invoice: NonNullable<Awaited<ReturnType<typeof getClientInvoice>>>,
  companyName: string,
  logoUrl?: string | null,
  invoicingSettings?: Parameters<typeof buildClientInvoiceHtml>[3]
) {
  return renderPdfFromHtml(buildClientInvoiceHtml(invoice, companyName, logoUrl, invoicingSettings), "client invoice PDF generation");
}

export async function buildClientInvoiceXeroCsv(invoice: NonNullable<Awaited<ReturnType<typeof getClientInvoice>>>) {
  const taxType = Number(invoice.gstAmount ?? 0) > 0 ? "OUTPUT" : "NONE";
  const header = [
    "ContactName",
    "EmailAddress",
    "InvoiceNumber",
    "InvoiceDate",
    "DueDate",
    "Description",
    "Quantity",
    "UnitAmount",
    "TaxType",
    "Reference",
  ];
  const rows = invoice.lines.map((line) => [
    invoice.client.name,
    invoice.client.email || "",
    invoice.invoiceNumber,
    format(new Date(invoice.createdAt), "yyyy-MM-dd"),
    format(new Date(invoice.periodEnd || invoice.createdAt), "yyyy-MM-dd"),
    line.description,
    line.quantity.toFixed(2),
    line.unitPrice.toFixed(2),
    taxType,
    line.job?.jobNumber || line.job?.id || line.id,
  ]);
  return [header, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
