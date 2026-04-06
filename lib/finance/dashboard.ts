import { startOfWeek, subDays } from "date-fns";
import { ClientInvoiceStatus, JobStatus, LeadStatus } from "@prisma/client";
import { db } from "@/lib/db";

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function weekKey(date: Date) {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  return start.toISOString().slice(0, 10);
}

function labelFromEmail(email: string | null | undefined) {
  return (email ?? "Unknown").split("@")[0] || "Unknown";
}

export async function getFinanceDashboardData(now = new Date()) {
  const [invoices, jobs, leads, clients, reviews] = await Promise.all([
    db.clientInvoice.findMany({
      where: { status: ClientInvoiceStatus.PAID },
      select: {
        id: true,
        clientId: true,
        totalAmount: true,
        paidAt: true,
        createdAt: true,
        lines: {
          select: {
            lineTotal: true,
            category: true,
            job: {
              select: {
                jobType: true,
                assignments: {
                  where: { removedAt: null },
                  select: { userId: true, user: { select: { name: true, email: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.job.findMany({
      where: { status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] } },
      select: {
        id: true,
        scheduledDate: true,
        jobType: true,
        property: { select: { clientId: true } },
        assignments: {
          where: { removedAt: null },
          select: { userId: true, user: { select: { name: true, email: true } } },
        },
        qaReviews: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { score: true, createdAt: true },
        },
      },
      orderBy: { scheduledDate: "asc" },
    }),
    db.quoteLead.findMany({
      select: { status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.client.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        invoices: { where: { status: ClientInvoiceStatus.PAID }, select: { totalAmount: true, paidAt: true, createdAt: true } },
        properties: { select: { jobs: { where: { status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] } }, select: { scheduledDate: true } } } },
      },
    }),
    db.qAReview.findMany({
      select: { score: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const revenueByMonthMap = new Map<string, number>();
  const revenueByServiceMap = new Map<string, number>();
  const revenueByCleanerMap = new Map<string, number>();

  for (const invoice of invoices) {
    const paidDate = invoice.paidAt ?? invoice.createdAt;
    const month = monthKey(paidDate);
    revenueByMonthMap.set(month, (revenueByMonthMap.get(month) ?? 0) + Number(invoice.totalAmount ?? 0));

    for (const line of invoice.lines) {
      const amount = Number(line.lineTotal ?? 0);
      const serviceLabel = line.job?.jobType?.replace(/_/g, " ") || line.category || "Other";
      revenueByServiceMap.set(serviceLabel, (revenueByServiceMap.get(serviceLabel) ?? 0) + amount);

      const assignments = line.job?.assignments ?? [];
      const share = assignments.length > 0 ? amount / assignments.length : 0;
      for (const assignment of assignments) {
        const cleanerName = assignment.user.name?.trim() || labelFromEmail(assignment.user.email);
        revenueByCleanerMap.set(cleanerName, (revenueByCleanerMap.get(cleanerName) ?? 0) + share);
      }
    }
  }

  const jobsByWeekMap = new Map<string, number>();
  for (const job of jobs) {
    const key = weekKey(job.scheduledDate);
    jobsByWeekMap.set(key, (jobsByWeekMap.get(key) ?? 0) + 1);
  }

  const qaTrendMap = new Map<string, { total: number; count: number }>();
  for (const review of reviews) {
    const key = weekKey(review.createdAt);
    const bucket = qaTrendMap.get(key) ?? { total: 0, count: 0 };
    bucket.total += Number(review.score ?? 0);
    bucket.count += 1;
    qaTrendMap.set(key, bucket);
  }

  const totalLeads = leads.length;
  const convertedLeads = leads.filter((lead) => lead.status === LeadStatus.CONVERTED).length;

  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const paidInvoices = invoices.filter((invoice) => (invoice.paidAt ?? invoice.createdAt) <= now);
  const mtdRevenue = paidInvoices
    .filter((invoice) => (invoice.paidAt ?? invoice.createdAt) >= startOfMonth)
    .reduce((sum, invoice) => sum + Number(invoice.totalAmount ?? 0), 0);
  const ytdRevenue = paidInvoices
    .filter((invoice) => (invoice.paidAt ?? invoice.createdAt) >= startOfYear)
    .reduce((sum, invoice) => sum + Number(invoice.totalAmount ?? 0), 0);
  const avgJobValue = paidInvoices.length > 0 ? paidInvoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount ?? 0), 0) / paidInvoices.length : 0;

  const sixtyDaysAgo = subDays(now, 60);
  const churnRiskClients = clients.filter((client) => {
    const allJobs = client.properties.flatMap((property) => property.jobs);
    if (allJobs.length < 2) return false;
    const latestJob = allJobs.reduce((latest, job) => (!latest || job.scheduledDate > latest ? job.scheduledDate : latest), null as Date | null);
    return !!latestJob && latestJob < sixtyDaysAgo;
  }).length;

  return {
    metrics: {
      mtdRevenue,
      ytdRevenue,
      avgJobValue,
      activeClients: clients.length,
      churnRiskClients,
      leadConversionRate: totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0,
    },
    revenueByMonth: Array.from(revenueByMonthMap.entries()).map(([label, revenue]) => ({ label, revenue })),
    revenueByServiceType: Array.from(revenueByServiceMap.entries())
      .map(([label, revenue]) => ({ label, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8),
    revenueByCleaner: Array.from(revenueByCleanerMap.entries())
      .map(([label, revenue]) => ({ label, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
    jobsCompletedPerWeek: Array.from(jobsByWeekMap.entries()).map(([label, jobs]) => ({ label, jobs })),
    qaTrend: Array.from(qaTrendMap.entries()).map(([label, bucket]) => ({ label, score: bucket.count > 0 ? bucket.total / bucket.count : 0 })),
  };
}
