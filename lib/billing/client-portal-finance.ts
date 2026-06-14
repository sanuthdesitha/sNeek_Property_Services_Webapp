import { ClientInvoiceStatus, JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { computeClientCharge } from "@/lib/finance/job-money";

export async function getClientFinanceOverview(clientId: string) {
  const [rates, existingInvoiceLines, invoices, completedJobs, priceBook] = await Promise.all([
    db.propertyClientRate.findMany({
      where: {
        property: { clientId },
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
      where: { clientId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        sentAt: true,
        periodStart: true,
        periodEnd: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 20,
    }),
    db.job.findMany({
      where: {
        property: { clientId },
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
