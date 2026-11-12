import { ClientInvoiceStatus, JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { computeClientCharge } from "@/lib/finance/job-money";
import { REDUCING_CREDIT_NOTES_SELECT } from "@/lib/finance/receivables";
import { FALLBACK_INVOICE_TIMEZONE, paymentTermsDaysFrom } from "@/lib/billing/invoice-due";
import { getAppSettings } from "@/lib/settings";
import { buildClientMoneyRow, summarizeToPay, type ClientMoneyTerms } from "@/lib/billing/client-portal-money";
import { formatInTimeZone } from "date-fns-tz";

/**
 * The client's payment terms, for due days. Null when they cannot be read:
 * the Money tab then says the due day is unavailable instead of guessing one.
 */
async function readMoneyTerms(clientId: string): Promise<ClientMoneyTerms | null> {
  try {
    const [client, settings] = await Promise.all([
      db.client.findUnique({ where: { id: clientId }, select: { paymentTermsDays: true } }),
      getAppSettings(),
    ]);
    if (!client || !settings) return null;
    return {
      clientTermsDays: client.paymentTermsDays ?? null,
      organisationDefaultDays: paymentTermsDaysFrom(settings.invoicing?.defaultPaymentTermsDays),
      timezone: settings.timezone || FALLBACK_INVOICE_TIMEZONE,
    };
  } catch {
    return null;
  }
}

export async function getClientFinanceOverview(clientId: string, propertyIds?: string[] | null) {
  const property = { clientId, ...(propertyIds ? { id: { in: propertyIds } } : {}) };
  const [rates, existingInvoiceLines, invoices, completedJobs, priceBook] = await Promise.all([
    db.propertyClientRate.findMany({
      where: {
        property,
        isActive: true,
      },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
          },
        },
      },
      orderBy: [{ property: { name: "asc" } }, { jobType: "asc" }],
    }),
    db.clientInvoiceLine.findMany({
      where: {
        jobId: { not: null },
        invoice: {
          clientId,
          status: { not: ClientInvoiceStatus.VOID },
        },
      },
      select: { jobId: true },
    }),
    db.clientInvoice.findMany({
      // A DRAFT invoice is unfinished internal work — figures still being
      // adjusted, lines still being added — and DRAFT is the model DEFAULT, so
      // every invoice passed through the client's view the moment it was
      // created. VOID is excluded for the same reason it already is on the
      // lines query above: a cancelled invoice is not something the client
      // owes. Both were also being summed into "total billed".
      where: {
        clientId,
        status: { notIn: [ClientInvoiceStatus.DRAFT, ClientInvoiceStatus.VOID] },
        ...(propertyIds ? { lines: { some: {}, every: { job: { property } } } } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        sentAt: true,
        periodStart: true,
        periodEnd: true,
        // Credit notes are shown deliberately (negative total, "Credit note"
        // label, never payable) so the client can see what reduced a balance.
        kind: true,
        creditsInvoice: { select: { invoiceNumber: true } },
        // Money tab (2026-11): what is still owed, the due day and the paid
        // day, read through the existing receivables and terms rules. The PDF
        // the client already downloads prints the same due day and lines.
        paidAmount: true,
        paidDate: true,
        paidAt: true,
        paymentTermsDays: true,
        creditNotes: REDUCING_CREDIT_NOTES_SELECT,
        lines: { select: { jobId: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 20,
    }),
    db.job.findMany({
      where: {
        property,
        status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] },
      },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        propertyId: true,
        fixedPrice: true,
        property: {
          select: {
            name: true,
            suburb: true,
          },
        },
      },
      orderBy: [{ scheduledDate: "desc" }],
      take: 50,
    }),
    db.priceBook.findMany({
      where: { isActive: true },
      select: { jobType: true, baseRate: true },
    }),
  ]);

  const terms = await readMoneyTerms(clientId);
  const todayKey = formatInTimeZone(new Date(), terms?.timezone ?? FALLBACK_INVOICE_TIMEZONE, "yyyy-MM-dd");
  const moneyRows = invoices.map((invoice) => buildClientMoneyRow({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    kind: invoice.kind,
    totalAmount: invoice.totalAmount,
    paidAmount: invoice.paidAmount ?? null,
    paidDate: invoice.paidDate ?? null,
    paidAt: invoice.paidAt ?? null,
    createdAt: invoice.createdAt,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    paymentTermsDays: invoice.paymentTermsDays ?? null,
    creditNotes: invoice.creditNotes ?? null,
    cleanLineCount: Array.isArray(invoice.lines) ? invoice.lines.filter((line) => line.jobId).length : null,
    otherLineCount: Array.isArray(invoice.lines) ? invoice.lines.filter((line) => !line.jobId).length : null,
  }, terms, todayKey));

  const invoicedJobIds = new Set(
    existingInvoiceLines.map((row) => row.jobId).filter((value): value is string => Boolean(value))
  );
  const propertyRates = rates.map((rate) => ({
    propertyId: rate.propertyId,
    jobType: rate.jobType,
    baseCharge: rate.baseCharge,
    defaultDescription: rate.defaultDescription,
  }));

  // Canonical client-charge math — same precedence (fixed job price → property
  // rate → job-type price) as the invoice generator, so the portal never drifts
  // from the admin invoice. Jobs with no resolvable charge are flagged, not hidden.
  const recentCharges = completedJobs.map((job) => {
    const charge = computeClientCharge(
      { jobType: job.jobType, propertyId: job.propertyId, fixedPrice: job.fixedPrice },
      { propertyRates, priceBook }
    );
    return {
      jobId: job.id,
      jobNumber: job.jobNumber,
      propertyName: job.property.name,
      suburb: job.property.suburb,
      jobType: job.jobType,
      scheduledDate: job.scheduledDate,
      amount: charge.amount ?? 0,
      chargeSource: charge.source,
      rateMissing: charge.rateMissing,
      invoiced: invoicedJobIds.has(job.id),
    };
  });

  // Only charges with a resolved amount count toward the pending total.
  const pendingCharges = recentCharges.filter((row) => !row.invoiced && !row.rateMissing);
  const totalBilled = Number(
    invoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0).toFixed(2)
  );
  const pendingChargeTotal = Number(
    pendingCharges.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2)
  );

  return {
    rates,
    invoices,
    money: { rows: moneyRows, toPay: summarizeToPay(moneyRows), termsKnown: terms !== null },
    recentCharges,
    pendingCharges,
    summary: {
      activeRates: rates.length,
      invoiceCount: invoices.length,
      totalBilled,
      pendingChargeCount: pendingCharges.length,
      pendingChargeTotal,
    },
  };
}
