import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { calculateGstBreakdown } from "@/lib/pricing/gst";
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export class ShoppingChargeConflict extends Error {}
export const shoppingClientChargeReviewSchema = z.object({ id: z.string().min(1), expectedRevision: z.number().int().nonnegative(), expenseBillable: z.boolean().default(true), shoppingMinutes: z.number().int().min(0).max(1440), hourlyRate: z.number().finite().min(0).max(10000).nullable(), treatment: z.enum(["PENDING", "AGENCY_DISBURSEMENT", "RECHARGE"]), status: z.enum(["DRAFT", "APPROVED"]), reviewNote: z.string().trim().max(2000).optional() }).strict();
/** Deterministic integer minutes; no repeated rounding can create extra time. */
export function allocateShoppingMinutes(lines: { id: string; amount: number }[], minutes: number) {
  const totalMinutes = Math.max(0, Math.min(1440, Math.floor(Number(minutes) || 0)));
  const weights = lines.map(line => ({ ...line, amount: Math.max(0, Number(line.amount) || 0) })).sort((a,b) => a.id.localeCompare(b.id));
  const total = weights.reduce((sum,line) => sum + line.amount, 0);
  const result = weights.map(line => { const exact = total ? totalMinutes * line.amount / total : totalMinutes / Math.max(1, weights.length); return { id: line.id, minutes: Math.floor(exact), fraction: exact - Math.floor(exact) }; });
  let remainder = totalMinutes - result.reduce((sum,line) => sum + line.minutes, 0);
  for (const line of [...result].sort((a,b) => b.fraction - a.fraction || a.id.localeCompare(b.id))) if (remainder-- > 0) line.minutes++;
  return result.map(({ id, minutes }) => ({ id, minutes }));
}
export function calculateShoppingAwareInvoiceTotals(lines: { category: string; lineTotal: number }[], gstEnabled: boolean) {
  const agency = round(lines.filter(line => line.category === "SHOPPING_DISBURSEMENT").reduce((sum,line) => sum + line.lineTotal, 0));
  const taxable = lines.filter(line => line.category !== "SHOPPING_DISBURSEMENT").reduce((sum,line) => sum + line.lineTotal, 0);
  const totals = calculateGstBreakdown(taxable, { gstEnabled });
  return { subtotal: round(totals.subtotal + agency), gstAmount: totals.gstAmount, totalAmount: round(totals.totalAmount + agency) };
}
async function hasLegacyInvoice(tx: Prisma.TransactionClient, runId: string) {
  const [stamp, line] = await Promise.all([
    tx.shoppingSettlement.findFirst({ where: { shoppingRunId: runId, includedInClientInvoiceId: { not: null } }, select: { id: true } }),
    tx.clientInvoiceLine.findFirst({ where: { shoppingRunId: runId, shoppingClientChargeId: null, invoice: { status: { not: "VOID" } } }, select: { id: true } }),
  ]); return Boolean(stamp || line);
}
async function pendingCharge(tx: Prisma.TransactionClient, input: { runId: string; propertyId: string; sourceKey: string; expenseAmount: number; shoppingMinutes: number }) {
  if (!Number.isFinite(input.expenseAmount) || input.expenseAmount < 0 || !Number.isInteger(input.shoppingMinutes) || input.shoppingMinutes < 0 || input.shoppingMinutes > 1440) throw new ShoppingChargeConflict("Invalid shopping allocation.");
  const property = await tx.property.findUnique({ where: { id: input.propertyId }, select: { clientId: true } });
  if (!property) throw new ShoppingChargeConflict("Shopping destination is unavailable.");
  const existing = await tx.shoppingClientCharge.findUnique({ where: { shoppingRunId_sourceKey: { shoppingRunId: input.runId, sourceKey: input.sourceKey } } });
  if (existing) {
    if (existing.propertyId !== input.propertyId || existing.clientId !== property.clientId || existing.allocatedExpenseAmount !== round(input.expenseAmount) || existing.allocatedMinutes !== input.shoppingMinutes) throw new ShoppingChargeConflict("This shopping source already has a different client allocation.");
    return existing;
  }
  const clientPaid = await tx.shoppingSettlement.findFirst({ where: { shoppingRunId: input.runId, OR: [{ paidByScope: "CLIENT" }, { paymentMethod: "CLIENT_CARD" }] }, select: { id: true } });
  return tx.shoppingClientCharge.create({ data: { shoppingRunId: input.runId, propertyId: input.propertyId, clientId: property.clientId, sourceKey: input.sourceKey, expenseAmount: clientPaid ? 0 : round(input.expenseAmount), allocatedExpenseAmount: round(input.expenseAmount), shoppingMinutes: input.shoppingMinutes, allocatedMinutes: input.shoppingMinutes } });
}
export async function ensureShoppingClientChargesForRun(runId: string, database: Prisma.TransactionClient = db) {
  const work = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "ShoppingRun" WHERE "id" = ${runId} FOR UPDATE`;
    if (await hasLegacyInvoice(tx, runId)) return [];
    const run = await tx.shoppingRun.findUnique({ where: { id: runId }, include: { lines: true, settlements: true } });
    if (!run?.submittedAt) return [];
    const existing = await tx.shoppingClientCharge.findMany({ where: { shoppingRunId: runId } });
    if (existing.length) return existing;
    const purchased = run.lines.filter(line => line.status === "PURCHASED" && line.purchasedQty > 0);
    const compat = run.legacySource as Record<string, unknown> | null;
    const allocation = allocateShoppingMinutes(purchased.map(line => ({ id: line.id, amount: Number(line.lineCost ?? line.purchasedQty * (line.unitCost ?? 0)) })), Number(compat?.shoppingTimeRequestedMinutes ?? 0));
    const groups = new Map<string, { amount: number; minutes: number }>();
    for (const line of purchased) {
      const minutes = allocation.find(item => item.id === line.id)?.minutes ?? 0;
      await tx.shoppingRunLine.update({ where: { id: line.id }, data: { shoppingMinutes: minutes } });
      if (!line.propertyId) continue;
      const group = groups.get(line.propertyId) ?? { amount: 0, minutes: 0 }; group.amount += Number(line.lineCost ?? line.purchasedQty * (line.unitCost ?? 0)); group.minutes += minutes; groups.set(line.propertyId, group);
    }
    const result = [];
    for (const [propertyId, group] of Array.from(groups)) result.push(await pendingCharge(tx, { runId, propertyId, sourceKey: `property:${propertyId}`, expenseAmount: group.amount, shoppingMinutes: group.minutes }));
    return result;
  };
  return database === db ? db.$transaction(work) : work(database);
}
export async function createShoppingClientChargeForDelivery(tx: Prisma.TransactionClient, input: { deliveryId: string; runId: string; propertyId: string; expenseAmount: number; shoppingMinutes: number }) {
  await tx.$queryRaw`SELECT "id" FROM "ShoppingRun" WHERE "id" = ${input.runId} FOR UPDATE`;
  if (await hasLegacyInvoice(tx, input.runId)) throw new ShoppingChargeConflict("This shopping run is already covered by a legacy client invoice. Review it before allocating a delivery charge.");
  return pendingCharge(tx, { ...input, sourceKey: `delivery:${input.deliveryId}` });
}
export function listShoppingClientCharges(runId: string) {
  return db.shoppingClientCharge.findMany({ where: { shoppingRunId: runId }, include: { property: { select: { id: true, name: true } }, client: { select: { id: true, name: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}
export async function reviewShoppingClientCharge(raw: z.input<typeof shoppingClientChargeReviewSchema>, actorId: string) {
  const input = shoppingClientChargeReviewSchema.parse(raw);
  if (input.status === "APPROVED" && (input.treatment === "PENDING" || (input.shoppingMinutes > 0 && input.hourlyRate === null))) throw new ShoppingChargeConflict("Choose the accounting treatment and an independent client hourly rate before approval.");
  if (input.status === "APPROVED" && (!input.expenseBillable || input.treatment === "AGENCY_DISBURSEMENT") && (input.reviewNote?.length ?? 0) < 3) throw new ShoppingChargeConflict("Record a review note for agency treatment or waived expenses.");
  return db.$transaction(async tx => {
    const first = await tx.shoppingClientCharge.findUnique({ where: { id: input.id } }); if (!first) throw new ShoppingChargeConflict("Shopping charge not found.");
    await tx.$queryRaw`SELECT "id" FROM "ShoppingRun" WHERE "id" = ${first.shoppingRunId} FOR UPDATE`;
    const current = await tx.shoppingClientCharge.findUnique({ where: { id: input.id }, include: { property: { select: { clientId: true } } } });
    if (!current || current.invoiceId || current.revision !== input.expectedRevision || current.property.clientId !== current.clientId || await hasLegacyInvoice(tx, current.shoppingRunId)) throw new ShoppingChargeConflict("Shopping billing changed. Refresh before reviewing.");
    const run = await tx.shoppingRun.findUniqueOrThrow({ where: { id: current.shoppingRunId }, include: { lines: true, shoppingClientCharges: true } });
    const recordedMinutes = Number((run.legacySource as Record<string, unknown> | null)?.shoppingTimeRequestedMinutes ?? 0);
    const generalMinutes = run.lines.filter(line => !line.propertyId && line.status === "PURCHASED").reduce((sum,line) => sum + line.shoppingMinutes, 0);
    const deliveredMinutes = run.shoppingClientCharges.filter(charge => charge.sourceKey.startsWith("delivery:")).reduce((sum,charge) => sum + charge.allocatedMinutes, 0);
    const otherMinutes = run.shoppingClientCharges.filter(charge => charge.id !== current.id).reduce((sum,charge) => sum + charge.shoppingMinutes, 0);
    if (input.shoppingMinutes + otherMinutes + Math.max(0, generalMinutes - deliveredMinutes) > recordedMinutes) throw new ShoppingChargeConflict("Client shopping minutes exceed the recorded run time, including time reserved for undelivered stock.");
    const clientPaid = await tx.shoppingSettlement.findFirst({ where: { shoppingRunId: current.shoppingRunId, OR: [{ paidByScope: "CLIENT" }, { paymentMethod: "CLIENT_CARD" }] }, select: { id: true } });
    const expenseAmount = input.expenseBillable && !clientPaid ? current.allocatedExpenseAmount : 0;
    const labourAmount = round(input.shoppingMinutes / 60 * (input.hourlyRate ?? 0));
    const changed = await tx.shoppingClientCharge.updateMany({ where: { id: current.id, revision: input.expectedRevision, invoiceId: null }, data: { expenseAmount, expenseBillable: input.expenseBillable, shoppingMinutes: input.shoppingMinutes, hourlyRate: input.hourlyRate, labourAmount, treatment: input.treatment, status: input.status, reviewNote: input.reviewNote || null, approvedAt: input.status === "APPROVED" ? new Date() : null, approvedById: input.status === "APPROVED" ? actorId : null, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new ShoppingChargeConflict("Shopping billing changed. Refresh before reviewing.");
    await tx.auditLog.create({ data: { userId: actorId, action: "SHOPPING_CLIENT_CHARGE_REVIEWED", entity: "ShoppingClientCharge", entityId: current.id, before: { revision: current.revision, status: current.status }, after: { ...input, expenseAmount, labourAmount } } });
    return tx.shoppingClientCharge.findUniqueOrThrow({ where: { id: current.id } });
  });
}
