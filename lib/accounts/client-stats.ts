import { db } from "@/lib/db";

export interface ClientStats {
  clientId: string;
  totalSpend: number;
  invoicesPaid: number;
  invoicesOutstanding: number;
  outstandingAmount: number;
  propertiesCount: number;
  activeSubscriptions: number;
  totalJobs: number;
  jobsLast30d: number;
  jobsLast90d: number;
  averageRating: number | null;
  ratingSampleSize: number;
  lastInvoiceAt: Date | null;
  lastJobAt: Date | null;
}

export async function getClientStats(clientId: string): Promise<ClientStats> {
  const [invoices, propertiesCount, subscriptions, jobs, feedback, satisfaction] = await Promise.all([
    db.clientInvoice
      .findMany({
        where: { clientId },
        select: { totalAmount: true, status: true, paidAt: true, sentAt: true, createdAt: true },
      })
      .catch(() => [] as any[]),
    db.property.count({ where: { clientId } }).catch(() => 0),
    // SubscriptionPlan in this schema is a marketing catalog (no clientId/status). Treat as 0.
    Promise.resolve(0),
    db.job
      .findMany({
        where: { property: { clientId } },
        select: { id: true, scheduledDate: true, status: true, updatedAt: true },
      })
      .catch(() => [] as any[]),
    db.jobFeedback
      .findMany({
        where: { clientId },
        select: { rating: true },
      })
      .catch(() => [] as any[]),
    db.clientSatisfactionRating
      .findMany({
        where: { clientId },
        select: { score: true },
      })
      .catch(() => [] as any[]),
  ]);

  const paid = invoices.filter((i: any) => i.status === "PAID");
  const outstanding = invoices.filter(
    (i: any) => i.status !== "PAID" && i.status !== "VOID" && i.status !== "DRAFT"
  );
  const totalSpend = paid.reduce((sum: number, i: any) => sum + Number(i.totalAmount || 0), 0);
  const outstandingAmount = outstanding.reduce(
    (sum: number, i: any) => sum + Number(i.totalAmount || 0),
    0
  );

  const lastInvoiceAt = invoices.reduce<Date | null>((acc, i: any) => {
    const candidate = i.paidAt ?? i.sentAt ?? i.createdAt;
    if (!candidate) return acc;
    const dt = new Date(candidate);
    return !acc || dt > acc ? dt : acc;
  }, null);

  const now = new Date();
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const day90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const jobsLast30d = jobs.filter(
    (j: any) => j.scheduledDate && new Date(j.scheduledDate) >= day30
  ).length;
  const jobsLast90d = jobs.filter(
    (j: any) => j.scheduledDate && new Date(j.scheduledDate) >= day90
  ).length;

  const lastJobAt = jobs.reduce<Date | null>((acc, j: any) => {
    const completed = j.status === "COMPLETED" || j.status === "INVOICED" ? j.updatedAt : null;
    const candidate = completed ?? j.scheduledDate;
    if (!candidate) return acc;
    const dt = new Date(candidate);
    return !acc || dt > acc ? dt : acc;
  }, null);

  const ratingsRaw = [
    ...feedback.map((f: any) => (typeof f.rating === "number" ? f.rating : null)),
    ...satisfaction.map((s: any) => (typeof s.score === "number" ? s.score : null)),
  ];
  const ratings = ratingsRaw.filter((r): r is number => r !== null);
  const averageRating =
    ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  return {
    clientId,
    totalSpend,
    invoicesPaid: paid.length,
    invoicesOutstanding: outstanding.length,
    outstandingAmount,
    propertiesCount,
    activeSubscriptions: subscriptions,
    totalJobs: jobs.length,
    jobsLast30d,
    jobsLast90d,
    averageRating,
    ratingSampleSize: ratings.length,
    lastInvoiceAt,
    lastJobAt,
  };
}
