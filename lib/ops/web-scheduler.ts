import { logger } from "@/lib/logger";
import { sendAdminAttentionSummary } from "@/lib/ops/admin-attention-summary";
import { dispatchJobReminders } from "@/lib/ops/reminders";
import { sendStockAlerts } from "@/lib/ops/stock-alerts";
import { dispatchTomorrowPrepSummaries } from "@/lib/ops/tomorrow-prep";

const WEB_SCHEDULER_MIN_INTERVAL_MS = 5 * 60_000;

type SchedulerState = {
  running: boolean;
  lastStartedAt: number;
};

declare global {
  var __sneekWebSchedulerState: SchedulerState | undefined;
}

function getState(): SchedulerState {
  if (!global.__sneekWebSchedulerState) {
    global.__sneekWebSchedulerState = {
      running: false,
      lastStartedAt: 0,
    };
  }
  return global.__sneekWebSchedulerState;
}

async function runScheduledTick() {
  await dispatchJobReminders({ reminderType: "ALL" });
  await dispatchTomorrowPrepSummaries(new Date());
  await sendStockAlerts();
  await sendAdminAttentionSummary({ now: new Date() });
}

export function kickWebScheduledOps() {
  if (process.env.SNEEK_DISABLE_WEB_SCHEDULED_FALLBACK === "1") return;

  const state = getState();
  const now = Date.now();
  if (state.running) return;
  if (now - state.lastStartedAt < WEB_SCHEDULER_MIN_INTERVAL_MS) return;

  state.running = true;
  state.lastStartedAt = now;

  setTimeout(() => {
    void runScheduledTick()
      .catch((err) => {
        logger.error({ err }, "Web scheduled fallback tick failed");
      })
      .finally(() => {
        state.running = false;
      });
  }, 0);
}
