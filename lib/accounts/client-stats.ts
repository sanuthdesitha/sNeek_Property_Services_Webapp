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

export interface ClientTrendPoint {
  /** Month label, e.g. "Apr". */
  label: string;
  revenue: number;
  jobs: number;
}

export interface ClientSpecialPayment {
  id: string;
  title: string | null;
  type: string;
  status: string;
  amount: number;
  cleanerName: string | null;
  requestedAt: Date;
}

export interface ClientExtras {
  /** Paid-invoice revenue + job count per month for the last 6 months. */
  trend: ClientTrendPoint[];
  /** Special payments / cleaner pay adjustments tied to this client's jobs or properties. */
  specialPayments: ClientSpecialPayment[];
  /** Recent client feedback (rating + comment) across their jobs. */
  recentFeedback: Array<{
    id: string;
    rating: number | null;
    comment: string | null;
    submittedAt: Date | null;
    propertyName: string | null;
  }>;
}

/**
 * Heavier per-client extras for the rich summary page: monthly revenue/jobs
 * trend, special payments (CleanerPayAdjustment tied to the client's
 * jobs/properties), and recent feedback. Defensive — any failing query falls
 * back to empty so the page still renders.
 */
export async function getClientExtras(clientId: string): Promise<ClientExtras> {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5, 1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [paidInvoices, jobs, specialPaymentsRaw, feedbackRaw] = await Promise.all([
    db.clientInvoice
      .findMany({
        where: { clientId, status: "PAID" },
        select: { totalAmount: true, paidAt: true, createdAt: true },
      })
      .catch(() => [] as any[]),
    db.job
      .findMany({
        where: { property: { clientId } },
        select: { id: true, status: true, scheduledDate: true, updatedAt: true },
      })
      .catch(() => [] as any[]),
    db.cleanerPayAdjustment
      .findMany({
        where: {
          OR: [{ job: { property: { clientId } } }, { property: { clientId } }],
        },
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          requestedAmount: true,
          approvedAmount: true,
          requestedAt: true,
          cleaner: { select: { name: true } },
        },
        orderBy: { requestedAt: "desc" },
        take: 20,
      })
      .catch(() => [] as any[]),
    db.jobFeedback
      .findMany({
        where: { clientId, submittedAt: { not: null } },
        select: {
          id: true,
          rating: true,
          comment: true,
          submittedAt: true,
          job: { select: { property: { select: { name: true } } } },
        },
        orderBy: { submittedAt: "desc" },
        take: 8,
      })
      .catch(() => [] as any[]),
  ]);

  // Build 6-month buckets
  const buckets: ClientTrendPoint[] = [];
  const idx = new Map<string, number>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    idx.set(key, buckets.length);
    buckets.push({ label: d.toLocaleDateString("en-AU", { month: "short" }), revenue: 0, jobs: 0 });
  }
  for (const inv of paidInvoices) {
    const when = inv.paidAt ?? inv.createdAt;
    if (!when) continue;
    const dt = new Date(when);
    const b = idx.get(`${dt.getFullYear()}-${dt.getMonth()}`);
    if (b !== undefined) buckets[b].revenue += Number(inv.totalAmount || 0);
  }
  for (const j of jobs) {
    if (j.status !== "COMPLETED" && j.status !== "INVOICED") continue;
    const when = j.updatedAt ?? j.scheduledDate;
    if (!when) continue;
    const dt = new Date(when);
    const b = idx.get(`${dt.getFullYear()}-${dt.getMonth()}`);
    if (b !== undefined) buckets[b].jobs += 1;
  }

  const specialPayments: ClientSpecialPayment[] = specialPaymentsRaw.map((p: any) => ({
    id: p.id,
    title: p.title ?? null,
    type: p.type,
    status: p.status,
    amount: Number(p.approvedAmount ?? p.requestedAmount ?? 0),
    cleanerName: p.cleaner?.name ?? null,
    requestedAt: p.requestedAt,
  }));

  const recentFeedback = feedbackRaw.map((f: any) => ({
    id: f.id,
    rating: typeof f.rating === "number" ? f.rating : null,
    comment: f.comment ?? null,
    submittedAt: f.submittedAt ?? null,
    propertyName: f.job?.property?.name ?? null,
  }));

  return { trend: buckets, specialPayments, recentFeedback };
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
