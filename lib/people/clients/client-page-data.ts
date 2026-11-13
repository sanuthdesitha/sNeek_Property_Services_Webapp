/**
 * Data for the client page (moved unchanged from app/v2/admin/clients/[id]
 * when the page was redrawn, People board 2026-11-12): the client, recent
 * jobs, approved/sent invoices, quotes, cases, leads and the 12-month profit
 * row from the canonical finance engine (never recomputed here).
 */
import "server-only";
import { ClientInvoiceStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getFinanceSummary } from "@/lib/finance/summary";
import { sydneyTodayKey, addDaysToKey } from "@/lib/time/sydney-range";

export async function loadClientPageData(id: string) {
  const client = await db.client
    .findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        suburb: true,
        state: true,
        postcode: true,
        notes: true,
        isActive: true,
        portalVisibilityOverrides: true,
        showCleanerLiveLocation: true,
        paymentTermsDays: true,
        createdAt: true,
        properties: {
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, suburb: true, bedrooms: true, bathrooms: true },
        },
      },
    })
    .catch(() => null);
  if (!client) return null;

  const propertyIds = client.properties.map((p) => p.id);

  const [recentJobs, outstanding, quotes, cases, leads] = await Promise.all([
    propertyIds.length
      ? db.job
          .findMany({
            where: { propertyId: { in: propertyIds } },
            orderBy: { scheduledDate: "desc" },
            take: 8,
            select: {
              id: true,
              jobNumber: true,
              jobType: true,
              status: true,
              scheduledDate: true,
              property: { select: { name: true, suburb: true } },
            },
          })
          .catch(() => [])
      : Promise.resolve([]),
    db.clientInvoice
      .findMany({
        where: {
          clientId: id,
          status: { in: [ClientInvoiceStatus.APPROVED, ClientInvoiceStatus.SENT] },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          totalAmount: true,
          createdAt: true,
        },
      })
      .catch(() => []),
    // Quotes are linked to the client directly (Quote.clientId), not through
    // properties — pre-conversion quotes often predate any property record.
    db.quote
      .findMany({
        where: { clientId: id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          serviceType: true,
          totalAmount: true,
          status: true,
          validUntil: true,
          createdAt: true,
        },
      })
      .catch(() => []),
    // "Cases" is the IssueTicket model (legacy name) — filter on the typed
    // `state`, but keep ALL states so resolved history stays visible here.
    db.issueTicket
      .findMany({
        where: { clientId: id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          title: true,
          caseType: true,
          state: true,
          createdAt: true,
        },
      })
      .catch(() => []),
    db.quoteLead
      .findMany({
        where: { clientId: id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          serviceType: true,
          status: true,
          estimateMin: true,
          estimateMax: true,
          createdAt: true,
        },
      })
      .catch(() => []),
  ]);

  const outstandingAud = outstanding.reduce((sum, inv) => sum + (inv.totalAmount ?? 0), 0);

  // Per-client profit over a trailing 12-month window. We reuse the canonical
  // finance engine (getFinanceSummary) and filter its byClient rows to this
  // client — never duplicate the margin math here.
  const todayKey = sydneyTodayKey();
  const startKey = addDaysToKey(todayKey, -365);
  const [finance, rateRows] = await Promise.all([
    getFinanceSummary({ startDate: startKey, endDate: todayKey }).catch(() => null),
    propertyIds.length
      ? db.propertyClientRate
          .findMany({
            where: { propertyId: { in: propertyIds }, isActive: true },
            select: { propertyId: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const profitRow = finance?.byClient.find((row) => row.clientId === id) ?? null;
  const activeRateCount = rateRows.length;
  const ratedPropertyCount = new Set(rateRows.map((r) => r.propertyId)).size;

  return {
    client,
    recentJobs,
    outstanding,
    outstandingAud,
    quotes,
    cases,
    leads,
    profitRow,
    activeRateCount,
    ratedPropertyCount,
  };
}

export type ClientPageData = NonNullable<Awaited<ReturnType<typeof loadClientPageData>>>;
