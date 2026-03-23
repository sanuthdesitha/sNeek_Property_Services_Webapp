import { ClientInvoiceStatus, JobStatus } from "@prisma/client";
import { db } from "@/lib/db";

export async function getClientFinanceOverview(clientId: string) {
  const [rates, existingInvoiceLines, invoices, completedJobs] = await Promise.all([
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
  ]);

  const invoicedJobIds = new Set(
    existingInvoiceLines.map((row) => row.jobId).filter((value): value is string => Boolean(value))
  );
  const rateMap = new Map(rates.map((rate) => [`${rate.propertyId}:${rate.jobType}`, rate]));

  const recentCharges = completedJobs
    .map((job) => {
      const rate = rateMap.get(`${job.propertyId}:${job.jobType}`);
      if (!rate) return null;
      return {
        jobId: job.id,
        jobNumber: job.jobNumber,
        propertyName: job.property.name,
        suburb: job.property.suburb,
        jobType: job.jobType,
        scheduledDate: job.scheduledDate,
        amount: Number(rate.baseCharge || 0),
        invoiced: invoicedJobIds.has(job.id),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const pendingCharges = recentCharges.filter((row) => !row.invoiced);
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
