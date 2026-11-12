/**
 * Loads every client with the facts People › Clients shows, in a fixed number
 * of batched queries (no per-client reads), then hands them to ./derive.
 * Money reuses lib/finance/receivables (owing) and the invoice list's overdue
 * and fully-credited ids (lib/billing/client-invoice-list), so this list, the
 * Finance figures and the client page agree.
 */
import "server-only";
import { ClientInvoiceStatus, JobStatus, Role } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { loadListContext } from "@/lib/billing/client-invoice-list";
import { creditedAmountOf, invoiceAmountOwing, isFullyCredited, OUTSTANDING_INVOICE_STATUSES, REDUCING_CREDIT_NOTES_SELECT } from "@/lib/finance/receivables";
import { buildClientRow, type ClientFacts } from "./derive";
import type { ClientDirectoryRow, ClientDirectoryVisibility } from "./types";

/** Statuses of a finished clean ("Last clean"). */
const FINISHED_JOB_STATUSES: JobStatus[] = [JobStatus.COMPLETED, JobStatus.INVOICED];

type Money = { invoicesOpen: number; owing: number; overdue: number; overdueCount: number };

async function loadMoney(now: Date): Promise<{ byClient: Map<string, Money>; paid: Map<string, number>; timezone: string } | null> {
  try {
    const context = await loadListContext(now);
    const overdueIds = new Set(context.overdueIds);
    const monthKey = formatInTimeZone(now, context.timezone, "yyyy-MM");
    const monthStart = fromZonedTime(`${monthKey}-01T00:00:00`, context.timezone);
    const [outstanding, paidRows] = await Promise.all([
      db.clientInvoice.findMany({
        where: { kind: "INVOICE", status: { in: [...OUTSTANDING_INVOICE_STATUSES] as ClientInvoiceStatus[] } },
        select: { id: true, clientId: true, totalAmount: true, paidAmount: true, creditNotes: REDUCING_CREDIT_NOTES_SELECT },
      }),
      db.clientInvoice.groupBy({
        by: ["clientId"],
        where: { kind: "INVOICE", status: ClientInvoiceStatus.PAID, paidAt: { gte: monthStart } },
        _sum: { totalAmount: true },
      }),
    ]);
    const byClient = new Map<string, Money>();
    for (const invoice of outstanding) {
      const facts = { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, creditedAmount: creditedAmountOf(invoice.creditNotes) };
      // A fully credited invoice is not money being chased (Finance rule).
      if (isFullyCredited(facts)) continue;
      const owing = invoiceAmountOwing(facts);
      const entry = byClient.get(invoice.clientId) ?? { invoicesOpen: 0, owing: 0, overdue: 0, overdueCount: 0 };
      entry.invoicesOpen += 1;
      entry.owing += owing;
      if (overdueIds.has(invoice.id)) {
        entry.overdue += owing;
        entry.overdueCount += 1;
      }
      byClient.set(invoice.clientId, entry);
    }
    const paid = new Map(paidRows.map((row) => [row.clientId, Number((row._sum.totalAmount ?? 0).toFixed(2))]));
    return { byClient, paid, timezone: context.timezone };
  } catch {
    // Unreadable money is shown as "–", never as $0.
    return null;
  }
}

export type ClientDirectoryLoad = { rows: ClientDirectoryRow[]; activeProperties: number };

export async function loadClientDirectory(visibility: ClientDirectoryVisibility, now: Date = new Date()): Promise<ClientDirectoryLoad> {
  const [clients, properties, logins, assistants, lastCleans, money] = await Promise.all([
    db.client.findMany({ select: { id: true, name: true, suburb: true, email: true, phone: true, isActive: true, createdAt: true } }),
    db.property.findMany({ where: { isActive: true }, select: { id: true, clientId: true } }),
    db.user.findMany({
      where: { role: Role.CLIENT, clientId: { not: null } },
      select: { clientId: true, isActive: true, invitation: { select: { acceptedAt: true } } },
    }),
    db.user.findMany({ where: { role: Role.VA, isActive: true, vaTeamId: { not: null } }, select: { vaTeam: { select: { clientId: true } } } }),
    db.job.groupBy({ by: ["propertyId"], where: { status: { in: FINISHED_JOB_STATUSES } }, _max: { scheduledDate: true } }),
    visibility.money ? loadMoney(now) : Promise.resolve(null),
  ]);
  const timezone = money?.timezone ?? "Australia/Sydney";

  const propertyClient = new Map<string, string>();
  const propertyCount = new Map<string, number>();
  for (const property of properties) {
    if (!property.clientId) continue;
    propertyClient.set(property.id, property.clientId);
    propertyCount.set(property.clientId, (propertyCount.get(property.clientId) ?? 0) + 1);
  }
  const allPropertyClients = await db.property.findMany({
    where: { id: { in: lastCleans.map((row) => row.propertyId) } },
    select: { id: true, clientId: true },
  });
  const lastClean = new Map<string, Date>();
  const ownerOf = new Map(allPropertyClients.map((row) => [row.id, row.clientId]));
  for (const row of lastCleans) {
    const clientId = ownerOf.get(row.propertyId) ?? propertyClient.get(row.propertyId);
    const day = row._max.scheduledDate;
    if (!clientId || !day) continue;
    const current = lastClean.get(clientId);
    if (!current || day > current) lastClean.set(clientId, day);
  }

  const loginCount = new Map<string, { active: number; invited: number }>();
  for (const login of logins) {
    if (!login.clientId) continue;
    const entry = loginCount.get(login.clientId) ?? { active: 0, invited: 0 };
    if (login.invitation && !login.invitation.acceptedAt) entry.invited += 1;
    else if (login.isActive) entry.active += 1;
    loginCount.set(login.clientId, entry);
  }
  const assistantCount = new Map<string, number>();
  for (const assistant of assistants) {
    const clientId = assistant.vaTeam?.clientId;
    if (clientId) assistantCount.set(clientId, (assistantCount.get(clientId) ?? 0) + 1);
  }

  const rows = clients.map((client) => {
    const owed = money?.byClient.get(client.id);
    const last = lastClean.get(client.id);
    const facts: ClientFacts = {
      ...client,
      properties: propertyCount.get(client.id) ?? 0,
      logins: loginCount.get(client.id)?.active ?? 0,
      loginsInvited: loginCount.get(client.id)?.invited ?? 0,
      assistants: assistantCount.get(client.id) ?? 0,
      invoicesOpen: owed?.invoicesOpen ?? 0,
      owing: money ? Number((owed?.owing ?? 0).toFixed(2)) : null,
      overdue: money ? Number((owed?.overdue ?? 0).toFixed(2)) : null,
      overdueCount: owed?.overdueCount ?? 0,
      paidThisMonth: money ? money.paid.get(client.id) ?? 0 : null,
      lastCleanDay: last ? formatInTimeZone(last, timezone, "yyyy-MM-dd") : null,
    };
    return buildClientRow(facts, visibility);
  });
  return { rows, activeProperties: properties.length };
}
