import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveAppUrl } from "@/lib/app-url";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { isPastLocalDispatchTime, localDateKey } from "@/lib/ops/scheduled-dispatch";

const STOCK_ALERTS_STATE_KEY = "stock_alerts_dispatch_v1";

interface StockAlertDispatchState {
  lastDispatchDate: string | null;
}

function defaultDispatchState(): StockAlertDispatchState {
  return { lastDispatchDate: null };
}

async function readDispatchState(): Promise<StockAlertDispatchState> {
  const row = await db.appSetting.findUnique({ where: { key: STOCK_ALERTS_STATE_KEY } });
  if (!row?.value || typeof row.value !== "object" || Array.isArray(row.value)) {
    return defaultDispatchState();
  }
  const value = row.value as Record<string, unknown>;
  return {
    lastDispatchDate:
      typeof value.lastDispatchDate === "string" && value.lastDispatchDate.trim()
        ? value.lastDispatchDate.trim()
        : null,
  };
}

async function writeDispatchState(state: StockAlertDispatchState) {
  await db.appSetting.upsert({
    where: { key: STOCK_ALERTS_STATE_KEY },
    create: { key: STOCK_ALERTS_STATE_KEY, value: state as any },
    update: { value: state as any },
  });
}

export interface SendStockAlertsOptions {
  now?: Date;
  ignoreWindow?: boolean;
  ignoreEnabled?: boolean;
}

export async function sendStockAlerts(options: SendStockAlertsOptions = {}) {
  const now = options.now ?? new Date();
  const settings = await getAppSettings();
  const timezone = settings.timezone || "Australia/Sydney";
  const todayKey = localDateKey(now, timezone);

  if (!settings.scheduledNotifications.stockAlertsEnabled && !options.ignoreEnabled) {
    return { sent: 0, admins: 0, lowStocks: 0, skipped: ["Stock alerts are disabled in settings."] };
  }

  if (
    !options.ignoreWindow &&
    !isPastLocalDispatchTime(now, timezone, settings.scheduledNotifications.stockAlertsTime, 7, 0)
  ) {
    return { sent: 0, admins: 0, lowStocks: 0, skipped: ["Before stock alert dispatch time."] };
  }

  const state = await readDispatchState();
  if (!options.ignoreWindow && state.lastDispatchDate === todayKey) {
    return { sent: 0, admins: 0, lowStocks: 0, skipped: ["Stock alerts already dispatched today."] };
  }

  const lowStocks = await db.propertyStock.findMany({
    where: { onHand: { lte: db.propertyStock.fields.reorderThreshold } },
    include: {
      item: true,
      property: { include: { client: true } },
    },
  });

  if (lowStocks.length === 0) {
    if (!options.ignoreWindow) {
      await writeDispatchState({ lastDispatchDate: todayKey });
    }
    return { sent: 0, admins: 0, lowStocks: 0, skipped: ["No low stock items found."] };
  }

  const adminUsers = await db.user.findMany({
    where: { role: { in: ["ADMIN", "OPS_MANAGER"] }, isActive: true },
    select: { id: true, email: true },
  });
  const lines = lowStocks
    .map(
      (stock) =>
        `- ${stock.property.name} - ${stock.item.name}: ${stock.onHand} ${stock.item.unit} on hand (par: ${stock.parLevel})`
    )
    .join("\n");

  let sent = 0;
  for (const admin of adminUsers) {
    if (!admin.email) continue;
    const inventoryUrl = resolveAppUrl("/admin/inventory");
    const inventoryLink = /^https?:\/\//i.test(inventoryUrl)
      ? `<p><a href="${inventoryUrl}">View shopping list</a></p>`
      : "";
    const ok = await sendEmail({
      to: admin.email,
      subject: `sNeek Ops: ${lowStocks.length} items low on stock`,
      html: `<p>${lowStocks.length} items are below reorder threshold:</p><pre>${lines}</pre>${inventoryLink}`,
    });
    await db.notification.create({
      data: {
        userId: admin.id,
        channel: NotificationChannel.EMAIL,
        subject: `Low stock alert (${lowStocks.length})`,
        body: `${lowStocks.length} items are below reorder threshold.`,
        status: ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: ok ? new Date() : undefined,
        errorMsg: ok ? undefined : "Low stock email failed.",
      },
    });
    if (ok) sent += 1;
  }

  if (!options.ignoreWindow) {
    await writeDispatchState({ lastDispatchDate: todayKey });
  }
  logger.info({ sent, admins: adminUsers.length, lowStocks: lowStocks.length }, "Stock alerts sent");
  return { sent, admins: adminUsers.length, lowStocks: lowStocks.length, skipped: [] as string[] };
}
