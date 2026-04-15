import { prisma } from "@/lib/db/prisma";

export async function deductStock(propertyId: string, itemId: string, quantity: number, submissionId?: string) {
  return prisma.propertyStock.update({
    where: { propertyId_itemId: { propertyId, itemId } },
    data: {
      onHand: { decrement: quantity },
      transactions: {
        create: {
          txType: "USED",
          quantity: -quantity,
          submissionId,
        },
      },
    },
  });
}

export async function restockStock(propertyId: string, itemId: string, quantity: number, notes?: string) {
  return prisma.propertyStock.update({
    where: { propertyId_itemId: { propertyId, itemId } },
    data: {
      onHand: { increment: quantity },
      transactions: {
        create: {
          txType: "RESTOCKED",
          quantity,
          notes,
        },
      },
    },
  });
}

export async function adjustStock(propertyId: string, itemId: string, quantity: number, notes?: string) {
  return prisma.propertyStock.update({
    where: { propertyId_itemId: { propertyId, itemId } },
    data: {
      onHand: { increment: quantity },
      transactions: {
        create: {
          txType: "ADJUSTED",
          quantity,
          notes,
        },
      },
    },
  });
}

export async function getLowStockAlerts() {
  const stocks = await prisma.propertyStock.findMany({
    include: {
      property: { select: { name: true, address: true } },
      item: { select: { name: true, sku: true, supplier: true } },
    },
  });
  return stocks.filter((s) => s.onHand <= s.reorderThreshold);
}

export async function getLowStockItems() {
  return prisma.propertyStock.findMany({
    where: {
      onHand: { lte: prisma.propertyStock.fields.reorderThreshold },
    },
    include: {
      property: { select: { name: true, address: true } },
      item: { select: { name: true, sku: true, supplier: true } },
    },
  });
}

export async function processFormSubmissionStock(submissionId: string, usageData: Record<string, { itemId: string; quantity: number }>) {
  const results = [];
  for (const [, usage] of Object.entries(usageData)) {
    const stock = await deductStock(
      // propertyId would need to be passed from the job context
      "",
      usage.itemId,
      usage.quantity,
      submissionId,
    );
    results.push(stock);
  }
  return results;
}
