import "server-only";
/**
 * The property page's Overview read model: "Coming up" (bookings joined to
 * jobs and laundry) and the rail summaries (client, laundry, NFC tags, stock,
 * billing rates, documents and additional details). Read only. A figure the
 * viewer may not see (money owed without finance access) is left out on the
 * server, not hidden in the browser.
 */
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseIntegrationNotes } from "@/lib/ical/options";
import { creditedAmountOf, OUTSTANDING_INVOICE_STATUSES, REDUCING_CREDIT_NOTES_SELECT, summarizeReceivables } from "@/lib/finance/receivables";
import { getPropertyFormConfig } from "@/lib/property-form/config-store";
import { addDaysToKey, sydneyDateKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { buildComingUp } from "./coming-up";
import { UPCOMING_JOB_STATUSES } from "./portfolio-facts";
import { loadLaundrySummary } from "./preview";
import { documentsAndDetails } from "./documents";
import type { ClientSummary, PropertyOverview, RateSummary, StockSummary } from "./preview-types";

export const COMING_UP_WINDOW_DAYS = 21;
const COMING_UP_MAX_ROWS = 8;
const FINISHED: JobStatus[] = [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED];

async function loadClientSummary(clientId: string, showMoney: boolean): Promise<ClientSummary> {
  const [client, propertyCount, invoices] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, name: true, phone: true, email: true, paymentTermsDays: true } }),
    db.property.count({ where: { clientId, isActive: true } }),
    showMoney
      ? db.clientInvoice.findMany({
          where: { clientId, kind: "INVOICE", status: { in: [...OUTSTANDING_INVOICE_STATUSES] } },
          select: { totalAmount: true, paidAmount: true, creditNotes: REDUCING_CREDIT_NOTES_SELECT },
        })
      : Promise.resolve(null),
  ]);
  const owing = invoices
    ? summarizeReceivables(invoices.map((row) => ({ totalAmount: row.totalAmount, paidAmount: row.paidAmount, creditedAmount: creditedAmountOf(row.creditNotes) }))).outstandingAud
    : null;
  return { ...client, propertyCount, owingAud: owing, owingShown: showMoney };
}

async function loadStockSummary(propertyId: string): Promise<StockSummary> {
  const rows = await db.propertyStock.findMany({
    where: { propertyId },
    select: { onHand: true, parLevel: true, reorderThreshold: true, item: { select: { name: true } } },
    orderBy: { item: { name: "asc" } },
  });
  return {
    tracked: rows.length,
    atOrBelowReorder: rows
      .filter((row) => row.onHand <= row.reorderThreshold)
      .map((row) => ({ name: row.item.name, onHand: row.onHand, parLevel: row.parLevel, reorderThreshold: row.reorderThreshold })),
  };
}

async function loadRates(propertyId: string): Promise<RateSummary> {
  const rows = await db.propertyClientRate.findMany({
    where: { propertyId },
    select: { jobType: true, baseCharge: true, billingUnit: true, isActive: true },
    orderBy: { jobType: "asc" },
  });
  return rows.map((row) => ({ ...row, jobType: String(row.jobType) }));
}

export async function loadPropertyOverview(propertyId: string, options: { showMoney: boolean }, now: Date = new Date()): Promise<PropertyOverview | null> {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true, clientId: true, accessInfo: true, customFields: true, laundryEnabled: true, laundryBagLabel: true, laundryBagColor: true,
      defaultCheckinTime: true, defaultCheckoutTime: true, requireNfcCheckIn: true,
      integration: { select: { isEnabled: true, icalUrl: true, notes: true } },
    },
  });
  if (!property) return null;

  const todayKey = sydneyTodayKey(now);
  const from = sydneyDayStart(todayKey);
  const until = sydneyDayStart(addDaysToKey(todayKey, COMING_UP_WINDOW_DAYS));
  const [settings, reservations, jobs, lastClean, client, laundry, tags, stock, rates, formConfig] = await Promise.all([
    getAppSettings(),
    db.reservation.findMany({
      where: { propertyId, endDate: { gte: sydneyDayStart(addDaysToKey(todayKey, -1)) }, startDate: { lt: until } },
      select: { id: true, startDate: true, endDate: true, guestName: true, checkinAtLocal: true, checkoutAtLocal: true },
    }),
    db.job.findMany({
      where: { propertyId, status: { in: UPCOMING_JOB_STATUSES }, scheduledDate: { gte: from, lt: until } },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
      select: {
        id: true, jobNumber: true, scheduledDate: true, startTime: true, status: true, reservationId: true,
        assignments: { where: { removedAt: null }, select: { user: { select: { name: true, email: true } } } },
        laundryTask: { select: { status: true, pickupDate: true, pickupTime: true, noPickupRequired: true } },
      },
    }),
    db.job.findFirst({ where: { propertyId, status: { in: FINISHED } }, orderBy: [{ scheduledDate: "desc" }], select: { id: true, jobNumber: true, scheduledDate: true } }),
    loadClientSummary(property.clientId, options.showMoney),
    loadLaundrySummary(property),
    db.propertyNfcTag.findMany({ where: { propertyId, isActive: true }, select: { label: true }, orderBy: { createdAt: "asc" } }),
    loadStockSummary(propertyId),
    loadRates(propertyId),
    getPropertyFormConfig(),
  ]);

  const linked = Boolean(property.integration?.isEnabled && property.integration.icalUrl);
  const comingUp = buildComingUp({
    todayKey,
    windowDays: COMING_UP_WINDOW_DAYS,
    maxRows: COMING_UP_MAX_ROWS,
    timeZone: settings.timezone || "Australia/Sydney",
    defaultCheckinTime: property.defaultCheckinTime,
    defaultCheckoutTime: property.defaultCheckoutTime,
    laundryEnabled: property.laundryEnabled !== false,
    syncCreatesJobs: linked && parseIntegrationNotes(property.integration?.notes).syncOptions.autoCreateTurnoverJobs,
    reservations,
    jobs: jobs.map((job) => ({
      id: job.id,
      jobNumber: job.jobNumber,
      scheduledDate: job.scheduledDate,
      startTime: job.startTime,
      status: job.status,
      reservationId: job.reservationId,
      cleaners: job.assignments.map((assignment) => assignment.user.name ?? assignment.user.email),
      laundry: job.laundryTask,
    })),
  });
  const { documents, details } = documentsAndDetails(property.accessInfo, property.customFields, formConfig.customFields);

  return {
    comingUp,
    comingUpWindowDays: COMING_UP_WINDOW_DAYS,
    lastClean: lastClean ? { dayKey: sydneyDateKey(lastClean.scheduledDate), jobId: lastClean.id, jobNumber: lastClean.jobNumber } : null,
    client,
    laundry,
    nfc: { active: tags.length, labels: tags.map((tag) => tag.label), required: property.requireNfcCheckIn },
    stock,
    rates,
    documents,
    details,
  };
}
