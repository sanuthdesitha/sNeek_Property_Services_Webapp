import { deliveryShare } from "./delivery-allocation";
import { db } from "@/lib/db";
import { getPresignedDownloadUrl } from "@/lib/s3";

const PAYMENT_LABELS: Record<string, string> = { COMPANY_CARD: "Company card", CLIENT_CARD: "Client card", CLEANER_CARD: "Cleaner card", ADMIN_CARD: "Admin card", CASH: "Cash", BANK_TRANSFER: "Bank transfer", OTHER: "Other" };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export async function getClientPurchases(clientId: string, options: { runId?: string; deliveryIds?: string[] } = {}) {
  const selectedDeliveryIds = options.deliveryIds ? Array.from(new Set(options.deliveryIds)) : null;
  if (selectedDeliveryIds && (!options.runId || !selectedDeliveryIds.length || selectedDeliveryIds.length > 100)) throw new Error("Invalid delivery selection.");
  if (selectedDeliveryIds) {
    const scoped = await db.heldStockDelivery.findMany({ where: { id: { in: selectedDeliveryIds }, property: { clientId }, heldStock: { shoppingRunLine: { shoppingRunId: options.runId } } }, select: { id: true } });
    if (scoped.length !== selectedDeliveryIds.length) throw new Error("Delivery selection is no longer available for this client.");
  }
  const runs = await db.shoppingRun.findMany({
    where: { ...(options.runId ? { id: options.runId } : {}), submittedAt: { not: null }, OR: [{ lines: { some: { status: "PURCHASED", property: { clientId }, purchasedQty: { gt: 0 } } } }, { shoppingClientCharges: { some: { clientId, property: { clientId } } } }] },
    select: { id: true, title: true, submittedAt: true, ownerUserId: true, legacySource: true, owner: { select: { name: true } },
      receipts: { select: { s3Key: true, fileName: true, mimeType: true, amount: true }, orderBy: { createdAt: "asc" } },
      settlements: { select: { paymentMethod: true }, take: 1 },
      lines: { where: { status: "PURCHASED", purchasedQty: { gt: 0 } }, select: { itemName: true, purchasedQty: true, unit: true, unitCost: true, lineCost: true, property: { select: { id: true, name: true, clientId: true } } } },
    }, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: options.runId ? 1 : 51,
  });
  const result = await Promise.all(runs.slice(0, 50).map(async run => {
    const own = run.lines.filter(line => line.property?.clientId === clientId);
    const wholeRunVisible = !selectedDeliveryIds && own.length > 0 && own.length === run.lines.length;
    const lines = (selectedDeliveryIds ? [] : own).map(line => ({ itemName: line.itemName, qty: line.purchasedQty, unit: line.unit, property: line.property!.name, unitCost: finite(line.unitCost) ? line.unitCost : null,
      lineCost: finite(line.lineCost) ? line.lineCost : finite(line.unitCost) ? line.unitCost * line.purchasedQty : null }));
    const charges = await db.shoppingClientCharge.findMany({ where: { shoppingRunId: run.id, clientId, property: { clientId }, ...(selectedDeliveryIds ? { sourceKey: { in: selectedDeliveryIds.map(id => `delivery:${id}`) } } : {}) }, select: { id: true, sourceKey: true, status: true, property: { select: { name: true } }, expenseAmount: true, shoppingMinutes: true, hourlyRate: true, labourAmount: true, treatment: true, invoice: { select: { id: true, clientId: true, status: true, invoiceNumber: true } } } });
    const deliveryIds = selectedDeliveryIds ?? charges.filter(charge => charge.sourceKey.startsWith("delivery:")).map(charge => charge.sourceKey.slice(9));
    if (deliveryIds.length) {
      const deliveries = await db.heldStockDelivery.findMany({ where: { id: { in: deliveryIds }, property: { clientId }, heldStock: { shoppingRunLine: { shoppingRunId: run.id, ...(selectedDeliveryIds ? {} : { propertyId: null }) } } }, select: { id: true, quantity: true, property: { select: { name: true } }, heldStock: { select: { deliveries: { select: { id: true, quantity: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, shoppingRunLine: { select: { itemName: true, unit: true, purchasedQty: true, lineCost: true, unitCost: true } } } } } });
      for (const delivery of deliveries) { const source = delivery.heldStock.shoppingRunLine; if (!source || source.purchasedQty <= 0) continue; const cost = finite(source.lineCost) ? source.lineCost / source.purchasedQty : finite(source.unitCost) ? source.unitCost : null; let deliveredBefore = 0; for (const prior of delivery.heldStock.deliveries) { if (prior.id === delivery.id) break; deliveredBefore += prior.quantity; } lines.push({ itemName: source.itemName, qty: delivery.quantity, unit: source.unit, property: delivery.property.name, unitCost: cost, lineCost: cost === null ? null : deliveryShare(Math.round(cost * source.purchasedQty * 100), source.purchasedQty, deliveredBefore, delivery.quantity) / 100 }); }
    }
    const billing = charges.map(charge => charge.status !== "APPROVED" ? { id: charge.id, property: charge.property.name, status: "PENDING_REVIEW" as const } : { id: charge.id, property: charge.property.name, status: "APPROVED" as const, expenseAmount: charge.expenseAmount, shoppingMinutes: charge.shoppingMinutes, hourlyRate: charge.hourlyRate, labourAmount: charge.labourAmount, treatment: charge.treatment, invoice: charge.invoice?.clientId === clientId ? { id: charge.invoice.id, status: charge.invoice.status, number: charge.invoice.invoiceNumber } : null });
    const compat = run.legacySource && typeof run.legacySource === "object" && !Array.isArray(run.legacySource) ? run.legacySource as Record<string, unknown> : {};
    const timeStatus = typeof compat.shoppingTimeStatus === "string" && ["NOT_REQUESTED", "PENDING", "APPROVED", "REJECTED", "INVOICED", "PAID"].includes(compat.shoppingTimeStatus) ? compat.shoppingTimeStatus : "UNKNOWN";
    const receipts = wholeRunVisible ? await Promise.all(run.receipts.map(async receipt => {
      const parts = receipt.s3Key.split("/");
      const owned = parts.length === 3 && parts[0] === "shopping-receipts" && parts[1] === run.ownerUserId && parts.every(part => part && part !== "." && part !== "..") && !/[\\\u0000-\u0020\u007f]/.test(receipt.s3Key);
      return { url: owned ? await getPresignedDownloadUrl(receipt.s3Key).catch(() => null) : null, name: receipt.fileName, mimeType: receipt.mimeType, amount: receipt.amount };
    })) : [];
    return { id: run.id, title: wholeRunVisible ? run.title : "Purchases for your properties", date: run.submittedAt!.toISOString(), shopper: run.owner?.name ?? "Team",
      paymentMethod: wholeRunVisible && run.settlements[0] ? PAYMENT_LABELS[run.settlements[0].paymentMethod] ?? "Other" : null,
      total: lines.reduce((sum, line) => sum + (line.lineCost ?? 0), 0), totalComplete: lines.every(line => line.lineCost !== null), lines, receipts,
      sharedRun: !wholeRunVisible, billing,
      shoppingTime: wholeRunVisible ? { requestedMinutes: finite(compat.shoppingTimeRequestedMinutes) ? compat.shoppingTimeRequestedMinutes : null, approvalStatus: timeStatus } : null,
    };
  }));
  return { runs: result, hasMore: runs.length > 50 };
}
