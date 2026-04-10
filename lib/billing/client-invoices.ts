import { randomUUID } from "crypto";
import { ClientInvoiceStatus, JobStatus, JobType } from "@prisma/client";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { renderPdfFromHtml } from "@/lib/reports/pdf";
import { getAppSettings } from "@/lib/settings";
import { calculateGstBreakdown } from "@/lib/pricing/gst";

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
}) {
  const [client, rates, existingInvoiced, settings] = await Promise.all([
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
        invoice: { status: { not: ClientInvoiceStatus.VOID } },
      },
      select: { jobId: true },
    }),
    getAppSettings(),
  ]);
  if (!client) {
    throw new Error("Client not found.");
  }

  const invoicedJobIds = new Set(existingInvoiced.map((row) => row.jobId).filter((value): value is string => Boolean(value)));
  const rateMap = new Map(rates.map((rate) => [`${rate.propertyId}:${rate.jobType}`, rate]));

  const jobs = await db.job.findMany({
    where: {
      property: {
        clientId: input.clientId,
        ...(input.propertyId ? { id: input.propertyId } : {}),
      },
      status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] },
      ...(input.periodStart || input.periodEnd
        ? {
            scheduledDate: {
              ...(input.periodStart ? { gte: input.periodStart } : {}),
              ...(input.periodEnd ? { lte: input.periodEnd } : {}),
            },
          }
        : {}),
    },
    include: {
      property: { select: { id: true, name: true, suburb: true } },
    },
    orderBy: [{ scheduledDate: "asc" }],
  });

  const lines = jobs
    .filter((job) => !invoicedJobIds.has(job.id))
    .map((job) => {
      const rate = rateMap.get(`${job.propertyId}:${job.jobType}`);
      if (!rate) return null;
      const description =
        rate.defaultDescription?.trim() ||
        `${job.property.name} - ${String(job.jobType).replace(/_/g, " ")} - ${format(new Date(job.scheduledDate), "dd MMM yyyy")}`;
      const lineTotal = Number(rate.baseCharge || 0);
      return {
        jobId: job.id,
        shoppingRunId: null,
        description,
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

  const { subtotal, gstAmount, totalAmount } = calculateGstBreakdown(
    allLines.reduce((sum, line) => sum + line.lineTotal, 0),
    settings.pricing
  );

  const invoice = await db.clientInvoice.create({
    data: {
      clientId: client.id,
      invoiceNumber: await nextInvoiceNumber(),
      status: ClientInvoiceStatus.DRAFT,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      subtotal,
      gstAmount,
      totalAmount,
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
    await db.shoppingSettlement.updateMany({
      where: { id: { in: shoppingLines.map((line) => line.settlementId) } },
      data: { includedInClientInvoiceId: invoice.id },
    });
  }

  return invoice;
}

export async function getClientInvoice(invoiceId: string) {
  return db.clientInvoice.findUnique({
    where: { id: invoiceId },
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
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });
}

export function buildClientInvoiceHtml(invoice: NonNullable<Awaited<ReturnType<typeof getClientInvoice>>>, companyName: string, logoUrl?: string | null) {
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

  return `
    <html>
      <body style="font-family:Arial,sans-serif;color:#111827;margin:32px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;">
          <div>
            ${logoUrl ? `<img src="${logoUrl}" alt="${escapeHtml(companyName)}" style="height:48px;margin-bottom:12px;" />` : ""}
            <h1 style="margin:0 0 8px;font-size:24px;">${escapeHtml(companyName)}</h1>
            <p style="margin:0;color:#6b7280;">Client Invoice</p>
          </div>
          <div style="text-align:right;">
            <p style="margin:0;"><strong>Invoice:</strong> ${escapeHtml(invoice.invoiceNumber)}</p>
            <p style="margin:4px 0 0;"><strong>Status:</strong> ${escapeHtml(invoice.status)}</p>
            <p style="margin:4px 0 0;"><strong>Created:</strong> ${format(new Date(invoice.createdAt), "dd MMM yyyy")}</p>
          </div>
        </div>

        <div style="margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:12px;color:#6b7280;">Bill To</p>
          <h2 style="margin:0 0 6px;font-size:18px;">${escapeHtml(invoice.client.name)}</h2>
          <p style="margin:0;color:#6b7280;">${escapeHtml(invoice.client.email || "")}</p>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:10px 8px;border-bottom:2px solid #111827;">Description</th>
              <th style="text-align:right;padding:10px 8px;border-bottom:2px solid #111827;">Qty</th>
              <th style="text-align:right;padding:10px 8px;border-bottom:2px solid #111827;">Rate</th>
              <th style="text-align:right;padding:10px 8px;border-bottom:2px solid #111827;">Total</th>
            </tr>
          </thead>
          <tbody>${linesHtml}</tbody>
        </table>

        <div style="margin-left:auto;max-width:320px;">
          <div style="display:flex;justify-content:space-between;padding:8px 0;">
            <span>Subtotal</span>
            <strong>${money(invoice.subtotal)}</strong>
          </div>
          ${gstSummaryHtml}
          <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:2px solid #111827;font-size:18px;">
            <span>Total</span>
            <strong>${money(invoice.totalAmount)}</strong>
          </div>
        </div>
      </body>
    </html>
  `;
}

export async function renderClientInvoicePdf(invoice: NonNullable<Awaited<ReturnType<typeof getClientInvoice>>>, companyName: string, logoUrl?: string | null) {
  return renderPdfFromHtml(buildClientInvoiceHtml(invoice, companyName, logoUrl), "client invoice PDF generation");
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
