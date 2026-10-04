import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { cleanerPreparationContext } from "@/lib/jobs/guest-summary";
import { urgentStockProperties, type StockActor, type UrgentNeed } from "./urgent-stock";
import { emptyStayPolicy, stayPreparationPolicySchema, stayNights, stayDemand, longStayInstruction, suppliedFromLedger } from "./stay-preparation-policy";
const key = (id: string) => `stay_preparation_v1:${id}`;
export async function readStayPolicy(propertyId: string) {
  const row = await db.appSetting.findUnique({ where: { key: key(propertyId) } });
  return stayPreparationPolicySchema.parse(row?.value ?? emptyStayPolicy);
}
export async function saveStayPolicy(actor: StockActor, propertyId: string, raw: unknown) {
  if (actor.role !== Role.ADMIN || !(await urgentStockProperties(actor)).some(row => row.id === propertyId)) throw Error("FORBIDDEN");
  const policy = stayPreparationPolicySchema.parse(raw);
  const items = await db.propertyStock.findMany({ where: { propertyId, item: { isActive: true } }, select: { itemId: true } });
  if (policy.items.some(row => !items.some(item => item.itemId === row.itemId))) throw Error("Choose inventory items configured for this property.");
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key(propertyId)}, 0))`;
    const before = await tx.appSetting.findUnique({ where: { key: key(propertyId) } });
    await tx.appSetting.upsert({ where: { key: key(propertyId) }, create: { key: key(propertyId), value: policy }, update: { value: policy } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "STAY_PREPARATION_POLICY_UPDATED", entity: "Property", entityId: propertyId, before: before?.value ?? Prisma.JsonNull, after: policy } });
    return policy;
  });
}
/** Caller already authorized this job. Read-only; forecasting cannot reserve or deduct inventory. */
export async function buildStayPreparation(job: { id: string; propertyId: string; internalNotes: string | null; sameDayCheckin: boolean; property: { name: string; accessInfo: unknown } }, now = new Date()) {
  const context = parseJobInternalNotes(job.internalNotes).reservationContext;
  const preparation = cleanerPreparationContext(context, job);
  const nights = stayNights(context);
  const guests = preparation.preparationGuestCount ?? null;
  const [policy, stocks, movements, reports, usageReceipt] = await Promise.all([
    readStayPolicy(job.propertyId),
    db.propertyStock.findMany({ where: { propertyId: job.propertyId, item: { isActive: true } }, include: { item: { select: { name: true, unit: true } }, transactions: { orderBy: { createdAt: "desc" }, take: 1 } } }),
    db.stockTx.findMany({ where: { submission: { jobId: job.id }, txType: "USED" }, select: { id: true, quantity: true, txType: true, propertyStockId: true } }),
    db.appSetting.findMany({ where: { key: { startsWith: "urgent_stock_v1:need:" }, value: { path: ["propertyId"], equals: job.propertyId } }, orderBy: { updatedAt: "desc" } }),
    db.appSetting.findUnique({ where: { key: `job_submission_stock_v1:${job.id}` } }),
  ]);
  const rows = policy.items.flatMap(rule => {
    const stock = stocks.find(row => row.itemId === rule.itemId); if (!stock) return [];
    const report = reports.map(row => row.value as unknown as UrgentNeed).find(row => row.itemId === rule.itemId) ?? null;
    const ledger = stock.transactions[0];
    // Only the latest applied physical observation can establish availability.
    // A later stock write or an aged observation makes verification unknown.
    const observedAt = report?.observedAt ? new Date(report.observedAt).getTime() : NaN;
    const verified = report?.observationDisposition === "APPLY" && report.observedCount === stock.onHand &&
      ledger?.notes?.startsWith("Urgent stock observation by ") && ledger.notes.endsWith(`observed ${report.observedAt}`) &&
      ledger.createdAt.getTime() === stock.updatedAt.getTime() && observedAt <= now.getTime() && now.getTime() - observedAt <= 86400000;
    const available = verified ? stock.onHand : null;
    const ledgerUsed = suppliedFromLedger(movements.filter(row => row.propertyStockId === stock.id));
    const reported = (usageReceipt?.value as { usage?: Record<string, unknown> } | null)?.usage?.[stock.itemId];
    // The ledger can be capped by an inventory shortfall. Preserve the actual
    // cleaner declaration separately; legacy ledger deductions cannot prove supply.
    const supplied = typeof reported === "number" && Number.isFinite(reported) && reported >= 0 ? reported : null;
    const estimated = stayDemand(rule, guests, nights);
    return [{ itemId: stock.itemId, name: stock.item.name, unit: stock.item.unit, estimated, available, supplied, ledgerUsed,
      remaining: estimated !== null && supplied !== null ? Math.max(0, estimated - supplied) : null,
      ledgerCount: stock.onHand, ledgerAt: stock.updatedAt.toISOString(), observedAt: report?.observedAt ?? null,
      reliability: verified ? "Fresh applied observation" : "Availability unverified; check property",
      reportId: report?.id ?? null, reportStage: report?.stage ?? null,
    }];
  });
  return { jobId: job.id, nights, guests, guestBasis: preparation.preparationSource ?? "UNKNOWN", staySource: nights === null ? "UNKNOWN" : "ICAL", startDate: context?.stayStartDate ?? null, endDate: context?.stayEndDate ?? null,
    generatedAt: now.toISOString(), towelInstruction: longStayInstruction(nights, policy.extraTowels), rows };
}
export async function listStayPreparation(actor: StockActor, propertyId: string, jobId?: string) {
  if (!(await urgentStockProperties(actor)).some(row => row.id === propertyId)) throw Error("FORBIDDEN");
  const jobs = await db.job.findMany({ where: { propertyId, ...(jobId ? { id: jobId } : { status: { in: ["UNASSIGNED", "OFFERED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PAUSED"] }, cleanSkipStatus: { not: "SKIPPED" } }),
    ...(actor.role === Role.ADMIN ? {} : { assignments: { some: { userId: actor.id, removedAt: null, responseStatus: { in: ["PENDING", "ACCEPTED"] } } } }) },
    include: { property: { select: { name: true, accessInfo: true } } }, orderBy: { scheduledDate: "asc" }, take: 20 });
  if (jobId && !jobs.length) throw Error("FORBIDDEN");
  const policy = await readStayPolicy(propertyId);
  return { policy, plans: await Promise.all(jobs.filter(job => !parseJobInternalNotes(job.internalNotes).isDraft).map(job => buildStayPreparation(job))) };
}
export type StayPreparation = Awaited<ReturnType<typeof buildStayPreparation>>;
