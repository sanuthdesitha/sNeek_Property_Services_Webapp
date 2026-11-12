/**
 * Server reads for Supplies → To do. Read-only and scoped to the session user:
 * their own scan tasks, their own open shopping runs and the urgent needs they
 * reported. Each read fails on its own and returns null ("could not be
 * loaded"), never an empty list that would claim nothing is waiting.
 */
import { db } from "@/lib/db";
import { isUrgentStockClosed, type UrgentStockStage } from "@/lib/inventory/urgent-stock-policy";
import type { TodoScanTask, TodoShoppingRun, TodoUrgentReport } from "@/components/v2/cleaner/supplies/supplies-todo";

const TZ = "Australia/Sydney";

function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(date);
}

function timeLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

async function loadScanTasks(userId: string): Promise<TodoScanTask[] | null> {
  try {
    const tasks = await db.scanTask.findMany({
      where: { assigneeId: userId, completedAt: null, cancelledAt: null },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 20,
      select: {
        id: true,
        instructions: true,
        dueAt: true,
        property: { select: { id: true, name: true, suburb: true } },
        requestedBy: { select: { name: true } },
      },
    });
    return tasks.map((task) => ({
      id: task.id,
      propertyId: task.property.id,
      propertyLabel: [task.property.name, task.property.suburb].filter(Boolean).join(" · "),
      requestedBy: task.requestedBy?.name?.trim() || "The office",
      dueLabel: task.dueAt ? dayLabel(task.dueAt) : null,
      instructions: task.instructions,
    }));
  } catch {
    return null;
  }
}

async function loadOpenRuns(userId: string): Promise<TodoShoppingRun[] | null> {
  try {
    const runs = await db.shoppingRun.findMany({
      where: { ownerUserId: userId, status: { in: ["DRAFT", "ACTIVE"] } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        status: true,
        lines: { select: { purchasedQty: true, lineCost: true } },
        _count: { select: { receipts: true } },
      },
    });
    return runs.map((run) => {
      const bought = run.lines.filter((line) => line.purchasedQty > 0);
      const costed = bought.filter((line) => typeof line.lineCost === "number");
      return {
        id: run.id,
        title: run.title,
        status: run.status,
        linesTotal: run.lines.length,
        linesBought: bought.length,
        spent: costed.length ? costed.reduce((sum, line) => sum + (line.lineCost ?? 0), 0) : null,
        boughtWithoutCost: bought.length - costed.length,
        receipts: run._count.receipts,
      };
    });
  } catch {
    return null;
  }
}

async function loadUrgentReports(userId: string): Promise<TodoUrgentReport[] | null> {
  try {
    const needs = await db.urgentStockNeed.findMany({
      where: { reportedById: userId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, itemName: true, propertyName: true, stage: true, updatedAt: true },
    });
    return needs
      .filter((need) => !isUrgentStockClosed(need.stage as UrgentStockStage))
      .map((need) => ({
        id: need.id,
        itemName: need.itemName,
        propertyName: need.propertyName,
        stage: need.stage,
        updatedLabel: timeLabel(need.updatedAt),
      }));
  } catch {
    return null;
  }
}

export async function loadSuppliesTodo(userId: string, shoppingEnabled: boolean) {
  const [scanTasks, runs, urgentReports] = await Promise.all([
    loadScanTasks(userId),
    shoppingEnabled ? loadOpenRuns(userId) : Promise.resolve<TodoShoppingRun[]>([]),
    loadUrgentReports(userId),
  ]);
  return { scanTasks, runs, urgentReports };
}
