import "server-only";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";

export type AiUsageRow = {
  feature: string;
  provider: string;
  model: string;
  calls: number;
  succeeded: number;
  failed: number;
  refused: number;
  inputTokens: number;
  outputTokens: number;
  /** Sum of calls with a known price, in micro-USD. */
  knownCostMicroUsd: number;
  /** Calls whose cost is not known (no saved price or no token counts). Never folded into $0. */
  unknownCostCalls: number;
};

export type AiMonthlyUsage = { monthLabel: string; timezone: string; from: string; rows: AiUsageRow[] };

const REFUSED = new Set(["NOT_CONFIGURED", "IMAGES_NOT_ALLOWED", "DISABLED", "RATE_LIMITED", "PROVIDER_CHANGED"]);

/** The calendar month containing `now` in the organisation timezone. */
export function monthWindow(now: Date, timezone: string): { from: Date; label: string } {
  const local = toZonedTime(now, timezone);
  const first = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-01T00:00:00`;
  const label = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: timezone }).format(now);
  return { from: fromZonedTime(first, timezone), label };
}

export async function getMonthlyAiUsage(now: Date, timezone: string): Promise<AiMonthlyUsage> {
  const window = monthWindow(now, timezone);
  const grouped = await db.aiCall.groupBy({
    by: ["feature", "provider", "model", "outcome"],
    where: { createdAt: { gte: window.from } },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true, costMicroUsd: true },
  });
  const unknown = await db.aiCall.groupBy({
    by: ["feature", "provider", "model"],
    where: { createdAt: { gte: window.from }, costMicroUsd: null, outcome: { notIn: Array.from(REFUSED) } },
    _count: { _all: true },
  });
  const rows = new Map<string, AiUsageRow>();
  for (const group of grouped) {
    const key = JSON.stringify([group.feature, group.provider, group.model]);
    const row = rows.get(key) ?? { feature: group.feature, provider: group.provider, model: group.model, calls: 0, succeeded: 0, failed: 0, refused: 0, inputTokens: 0, outputTokens: 0, knownCostMicroUsd: 0, unknownCostCalls: 0 };
    const count = group._count._all;
    row.calls += count;
    if (group.outcome === "OK") row.succeeded += count;
    else if (REFUSED.has(group.outcome)) row.refused += count;
    else row.failed += count;
    row.inputTokens += group._sum.inputTokens ?? 0;
    row.outputTokens += group._sum.outputTokens ?? 0;
    row.knownCostMicroUsd += group._sum.costMicroUsd ?? 0;
    rows.set(key, row);
  }
  for (const group of unknown) {
    const row = rows.get(JSON.stringify([group.feature, group.provider, group.model]));
    if (row) row.unknownCostCalls += group._count._all;
  }
  return {
    monthLabel: window.label,
    timezone,
    from: window.from.toISOString(),
    rows: Array.from(rows.values()).sort((a, b) => a.feature.localeCompare(b.feature) || b.calls - a.calls),
  };
}
