import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { pushClientInvoiceToXero } from "@/lib/xero/client";
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const [invoice, integrations] = await Promise.all([
      db.clientInvoice.findUnique({
        where: { id: params.id },
        include: {
          client: true,
          lines: {
            include: {
              job: {
                select: {
                  jobType: true,
                  jobNumber: true,
                },
              },
            },
          },
        },
      }),
      getPhase3IntegrationsSettings(),
    ]);

    if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

    const accountCode = integrations.xero.defaultAccountCode || "200";
    const defaultItemCode = integrations.xero.defaultItemCode?.trim() || "";
    const itemCodeByService = integrations.xero.itemCodeByService ?? {};
    // Per line: prefer the item code mapped to that job's service type, else the
    // default item code, else none.
    const itemCodeFor = (line: (typeof invoice.lines)[number]) => {
      const svc = line.job?.jobType ? itemCodeByService[line.job.jobType]?.trim() : "";
      return svc || defaultItemCode || undefined;
    };
    // Only send an explicit tax type when configured (e.g. AU "OUTPUT2"); leaving
    // it undefined lets Xero apply the sales account's own default tax rate,
    // which avoids region-specific "invalid TaxType" 400s.
    const taxType = integrations.xero.salesTaxType?.trim() || undefined;
    const reference =
      invoice.periodStart && invoice.periodEnd
        ? `Service period ${isoDate(invoice.periodStart)} – ${isoDate(invoice.periodEnd)}`
        : undefined;

    // The stored line.description already reads "Property - Service - date"; just
    // append the job number (and any per-job note) — no duplicate property/date.
    const buildDescription = (line: (typeof invoice.lines)[number]) => {
      let desc = line.description;
      if (line.job?.jobNumber) desc += ` · Job ${line.job.jobNumber}`;
      if (line.note) desc += ` — ${line.note}`;
      return desc;
    };

    const result = await pushClientInvoiceToXero({
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.client.name || "Unknown Client",
      clientEmail: invoice.client.email || integrations.xero.contactFallbackEmail || "no-reply@sneekops.com.au",
      clientXeroContactId: invoice.client.xeroContactId ?? undefined,
      lineItems: invoice.lines.map((line) => ({
        description: buildDescription(line),
        quantity: line.quantity,
        unitAmount: line.unitPrice,
        accountCode,
        taxType,
        itemCode: itemCodeFor(line),
      })),
      date: isoDate(invoice.createdAt),
      reference,
      gstEnabled: invoice.gstEnabled,
    });

    // Persist the Xero invoice id + export time, and remember the contact id so
    // future pushes reuse the same Xero contact instead of creating duplicates.
    await db.clientInvoice.update({
      where: { id: invoice.id },
      data: { xeroInvoiceId: result.xeroInvoiceId, xeroExportedAt: new Date() },
    });
    if (!invoice.client.xeroContactId && result.contactId) {
      await db.client.update({
        where: { id: invoice.clientId },
        data: { xeroContactId: result.contactId },
      });
    }

    return NextResponse.json({ ok: true, xeroInvoiceId: result.xeroInvoiceId });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not push invoice to Xero." }, { status });
  }
}
