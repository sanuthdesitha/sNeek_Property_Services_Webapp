/**
 * Loads one client's summary (People side panel, client page key facts and
 * rail). Reuses the Finance definitions: owing per invoice from
 * lib/finance/receivables, due day from lib/billing/invoice-due, overdue ids
 * from the invoice list, margin from getFinanceSummary (never recomputed).
 */
import "server-only";
import { CaseState, ClientInvoiceStatus, JobStatus, QuoteStatus, Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { loadListContext } from "@/lib/billing/client-invoice-list";
import { effectivePaymentTermsDays, invoiceDueDay, paymentTermsDaysFrom } from "@/lib/billing/invoice-due";
import { creditedAmountOf, invoiceAmountOwing, isFullyCredited, OUTSTANDING_INVOICE_STATUSES, REDUCING_CREDIT_NOTES_SELECT } from "@/lib/finance/receivables";
import { getFinanceSummary } from "@/lib/finance/summary";
import { getAppSettings } from "@/lib/settings";
import { parseVaPropertyScope } from "@/lib/va/permissions";
import { addDaysToKey, sydneyTodayKey } from "@/lib/time/sydney-range";
import type { ClientAttentionItem, ClientInvoiceSummary, ClientPropertySummary, ClientSummary } from "./summary-types";

const FINISHED: JobStatus[] = [JobStatus.COMPLETED, JobStatus.INVOICED, JobStatus.QA_REVIEW];
const NOT_UPCOMING: JobStatus[] = [JobStatus.COMPLETED, JobStatus.INVOICED, JobStatus.QA_REVIEW, JobStatus.CANCELLED];
const OPEN_CASE_STATES: CaseState[] = [CaseState.OPEN, CaseState.TRIAGE, CaseState.ASSIGNED, CaseState.IN_PROGRESS, CaseState.AWAITING_CLIENT];
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS);
}

async function loadInvoices(clientId: string, clientTerms: number | null, now: Date): Promise<{ invoices: ClientInvoiceSummary[]; owing: number; overdue: number } | null> {
  try {
    const context = await loadListContext(now);
    const overdueIds = new Set(context.overdueIds);
    const today = formatInTimeZone(now, context.timezone, "yyyy-MM-dd");
    const rows = await db.clientInvoice.findMany({
      where: { clientId, kind: "INVOICE", status: { in: [...OUTSTANDING_INVOICE_STATUSES] as ClientInvoiceStatus[] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, invoiceNumber: true, status: true, createdAt: true, totalAmount: true, paidAmount: true, paymentTermsDays: true, creditNotes: REDUCING_CREDIT_NOTES_SELECT },
    });
    const invoices: ClientInvoiceSummary[] = [];
    for (const row of rows) {
      const facts = { totalAmount: row.totalAmount, paidAmount: row.paidAmount, creditedAmount: creditedAmountOf(row.creditNotes) };
      if (isFullyCredited(facts)) continue;
      const terms = effectivePaymentTermsDays({ invoiceTermsDays: row.paymentTermsDays, clientTermsDays: clientTerms, organisationDefaultDays: context.paymentTermsDays });
      const dueDay = invoiceDueDay(row.createdAt, terms, context.timezone);
      const overdue = overdueIds.has(row.id);
      invoices.push({ id: row.id, invoiceNumber: row.invoiceNumber, status: row.status, owing: Number(invoiceAmountOwing(facts).toFixed(2)), dueDay, overdue, daysOverdue: overdue ? Math.max(1, daysBetween(dueDay, today)) : 0 });
    }
    const owing = Number(invoices.reduce((sum, invoice) => sum + invoice.owing, 0).toFixed(2));
    const overdue = Number(invoices.filter((invoice) => invoice.overdue).reduce((sum, invoice) => sum + invoice.owing, 0).toFixed(2));
    return { invoices, owing, overdue };
  } catch {
    return null;
  }
}

async function loadProfit(clientId: string) {
  const todayKey = sydneyTodayKey();
  const summary = await getFinanceSummary({ startDate: addDaysToKey(todayKey, -365), endDate: todayKey }).catch(() => null);
  if (!summary) return null;
  // A client with no work in the window has a real zero row from the engine's point of view.
  return summary.byClient.find((row) => row.clientId === clientId) ?? { revenue: 0, cleanerCost: 0, grossMargin: 0, marginPct: null };
}

async function loadProperties(clientId: string, now: Date): Promise<ClientPropertySummary[]> {
  const properties = await db.property.findMany({
    where: { clientId, isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, suburb: true,
      integration: { select: { isEnabled: true, icalUrl: true, syncStatus: true, lastSyncAt: true, updatedAt: true } },
      clientRates: { where: { isActive: true, jobType: "AIRBNB_TURNOVER" }, select: { baseCharge: true } },
    },
  });
  const ids = properties.map((property) => property.id);
  if (ids.length === 0) return [];
  const [upcoming, finished] = await Promise.all([
    db.job.findMany({
      where: { propertyId: { in: ids }, scheduledDate: { gte: new Date(now.getTime() - DAY_MS) }, status: { notIn: NOT_UPCOMING } },
      orderBy: { scheduledDate: "asc" },
      select: { propertyId: true, scheduledDate: true, status: true },
    }),
    db.job.findMany({
      where: { propertyId: { in: ids }, status: { in: FINISHED } },
      orderBy: { scheduledDate: "desc" },
      distinct: ["propertyId"],
      select: { propertyId: true, scheduledDate: true, status: true },
    }),
  ]);
  const nextBy = new Map<string, (typeof upcoming)[number]>();
  for (const job of upcoming) if (!nextBy.has(job.propertyId)) nextBy.set(job.propertyId, job);
  const lastBy = new Map(finished.map((job) => [job.propertyId, job]));
  return properties.map((property) => {
    const next = nextBy.get(property.id);
    const last = lastBy.get(property.id);
    const integration = property.integration;
    const calendar: ClientPropertySummary["calendar"] = !integration?.icalUrl ? "NOT_CONNECTED" : !integration.isEnabled ? "DISABLED" : integration.syncStatus === "ERROR" ? "FAILED" : "SYNCED";
    return {
      id: property.id,
      name: property.name,
      suburb: property.suburb,
      nextCleanAt: next ? next.scheduledDate.toISOString() : null,
      nextCleanUnassigned: next?.status === JobStatus.UNASSIGNED,
      lastCleanAt: last ? last.scheduledDate.toISOString() : null,
      awaitingReview: last?.status === JobStatus.QA_REVIEW,
      turnoverRate: property.clientRates[0]?.baseCharge ?? null,
      calendar,
      calendarFailedSince: calendar === "FAILED" ? (integration?.lastSyncAt ?? integration?.updatedAt ?? null)?.toISOString() ?? null : null,
    };
  });
}

export async function loadClientSummary(clientId: string, options: { money: boolean; profit: boolean }, now: Date = new Date()): Promise<ClientSummary | null> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, email: true, phone: true, address: true, suburb: true, notes: true, isActive: true, createdAt: true, paymentTermsDays: true },
  });
  if (!client) return null;
  const [settings, invoices, profit, properties, logins, teams, cases, quotes] = await Promise.all([
    getAppSettings(),
    options.money ? loadInvoices(client.id, client.paymentTermsDays ?? null, now) : Promise.resolve(null),
    options.money && options.profit ? loadProfit(client.id) : Promise.resolve(null),
    loadProperties(client.id, now),
    db.user.findMany({
      where: { clientId: client.id, role: Role.CLIENT },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, isActive: true, lastSeenAt: true, invitation: { select: { acceptedAt: true } } },
    }),
    db.vaTeam.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, isActive: true, propertyIds: true, _count: { select: { members: true } } } }),
    db.issueTicket.findMany({ where: { clientId: client.id, state: { in: OPEN_CASE_STATES } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true } }),
    db.quote.findMany({ where: { clientId: client.id, status: QuoteStatus.SENT }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, serviceType: true, validUntil: true } }),
  ]);
  const defaultDays = paymentTermsDaysFrom(settings.invoicing?.defaultPaymentTermsDays);
  const attention: ClientAttentionItem[] = [
    ...(invoices?.invoices ?? []).filter((invoice) => invoice.overdue).map((invoice) => ({ kind: "INVOICE" as const, label: `${invoice.invoiceNumber} overdue ${invoice.daysOverdue} d`, href: `/v2/admin/finance/invoices/${invoice.id}` })),
    ...cases.map((row) => ({ kind: "CASE" as const, label: row.title, href: `/v2/admin/cases?caseId=${row.id}` })),
    ...quotes.map((row) => ({ kind: "QUOTE" as const, label: `Quote sent${row.validUntil ? `, valid until ${formatInTimeZone(row.validUntil, settings.timezone || "Australia/Sydney", "d MMM")}` : ""}`, href: `/v2/admin/quotes/${row.id}` })),
  ];
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    phone: client.phone,
    address: client.address,
    suburb: client.suburb,
    notes: client.notes,
    isActive: client.isActive,
    createdAt: client.createdAt.toISOString(),
    terms: client.paymentTermsDays ? { days: client.paymentTermsDays, source: "CLIENT" } : { days: defaultDays, source: "DEFAULT" },
    money: options.money
      ? {
          owing: invoices?.owing ?? null,
          overdue: invoices?.overdue ?? null,
          invoices: invoices?.invoices ?? [],
          revenue12: profit ? profit.revenue : null,
          cleanerCost12: profit ? profit.cleanerCost : null,
          margin12: profit ? profit.grossMargin : null,
          marginPct12: profit ? profit.marginPct : null,
        }
      : null,
    properties,
    logins: logins.map((login) => ({ id: login.id, name: login.name, email: login.email, isActive: login.isActive, invited: Boolean(login.invitation && !login.invitation.acceptedAt), lastSeenAt: login.lastSeenAt?.toISOString() ?? null })),
    teams: teams.map((team) => ({ id: team.id, name: team.name, isActive: team.isActive, members: team._count.members, propertyCount: parseVaPropertyScope(team.propertyIds)?.length ?? null })),
    attention,
  };
}
