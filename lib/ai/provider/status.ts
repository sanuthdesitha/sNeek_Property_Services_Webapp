import "server-only";
import { db } from "@/lib/db";
import { getResolvedVisionProviderConfiguration } from "@/lib/ai/config";
import { getOllamaSettings } from "@/lib/ai/ollama-settings";
import { AI_FEATURES, AI_PROVIDER_KINDS, type AiFeature, type AiProviderKind } from "./routing-schema";
import type { FeatureTestResult } from "./tasks";

/**
 * Facts the AI configuration page shows beside the settings, read from the
 * existing tables only (AiTask, AiCall, RateLimitWindow, AuditLog, the Ollama
 * setting). Nothing here is estimated: a fact that was never recorded is null
 * and the screen says "Not recorded" / "Not known".
 */

/** The latest connection test of one feature (any administrator's). */
export type AiFeatureTestSummary = {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  /** Finished time, or the queue time while still waiting. */
  at: string;
  ok: boolean | null;
  message: string | null;
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  /** Technical detail from the audit row of the failed request, e.g. "AUTH · anthropic". */
  detail: string | null;
};

/** How a provider has behaved on real requests and tests (AiCall audit). */
export type AiProviderHealth = {
  lastOkAt: string | null;
  lastFailure: { at: string; outcome: string; errorCode: string | null; feature: string } | null;
  /** Failed requests after the last successful one (at most the last 7 days). */
  failuresSinceOk: number;
};

/** People who reached a feature's hourly limit in the current window. */
export type AiLimitHits = { resetsAt: string; people: { name: string; used: number | null }[] };

export type AiOllamaFacts = {
  configured: boolean;
  /** Host and port only, never a path or key. */
  host: string | null;
  textModel: string | null;
  visionModel: string | null;
  useForText: boolean;
};

/** null for a part that could not be read: the screen says "Not known", never "none". */
export type AiStatusFacts = {
  lastTests: Partial<Record<AiFeature, AiFeatureTestSummary>> | null;
  providers: Partial<Record<AiProviderKind, AiProviderHealth>> | null;
  limitHits: Partial<Record<AiFeature, AiLimitHits>> | null;
  lastSaved: { at: string; by: string | null } | null;
  ollama: AiOllamaFacts | null;
};

const FAILED_OUTCOMES = ["PROVIDER_ERROR", "TIMEOUT", "INVALID_OUTPUT"];
const HOUR_MS = 3_600_000;
const HEALTH_WINDOW_MS = 7 * 86_400_000;
const TEST_STATUSES = new Set(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]);

function readTestResult(value: unknown): FeatureTestResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<FeatureTestResult>;
  return typeof result.ok === "boolean" && typeof result.message === "string" ? (result as FeatureTestResult) : null;
}

type TestMap = NonNullable<AiStatusFacts["lastTests"]>;
type HealthMap = NonNullable<AiStatusFacts["providers"]>;
type HitMap = NonNullable<AiStatusFacts["limitHits"]>;

async function latestFeatureTests(): Promise<TestMap> {
  const out: TestMap = {};
  await Promise.all(AI_FEATURES.map(async (feature) => {
    const task = await db.aiTask.findFirst({ where: { kind: "feature_test", feature }, orderBy: { createdAt: "desc" } });
    if (!task) return;
    const result = readTestResult(task.result);
    let detail: string | null = null;
    if (task.status === "FAILED") {
      const call = await db.aiCall.findFirst({
        where: { entityType: "AiFeatureTest", entityId: feature, createdAt: { gte: task.createdAt, ...(task.finishedAt ? { lte: task.finishedAt } : {}) }, outcome: { not: "OK" } },
        orderBy: { createdAt: "desc" },
        select: { outcome: true, errorCode: true, provider: true },
      });
      if (call) detail = [call.errorCode ?? call.outcome, call.provider].join(" · ");
    }
    out[feature] = {
      status: (TEST_STATUSES.has(task.status) ? task.status : "FAILED") as AiFeatureTestSummary["status"],
      at: (task.finishedAt ?? task.createdAt).toISOString(),
      ok: task.status === "SUCCEEDED" ? true : task.status === "FAILED" ? false : null,
      message: result?.message ?? task.error ?? null,
      provider: result?.provider || null,
      model: result?.model || null,
      durationMs: typeof result?.durationMs === "number" ? result.durationMs : null,
      detail,
    };
  }));
  return out;
}

async function providerHealth(now: Date): Promise<HealthMap> {
  const out: HealthMap = {};
  const since = new Date(now.getTime() - HEALTH_WINDOW_MS);
  await Promise.all(AI_PROVIDER_KINDS.map(async (provider) => {
    const [ok, failure] = await Promise.all([
      db.aiCall.findFirst({ where: { provider, outcome: "OK" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.aiCall.findFirst({ where: { provider, outcome: { in: FAILED_OUTCOMES } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, outcome: true, errorCode: true, feature: true } }),
    ]);
    if (!ok && !failure) return;
    const after = ok && ok.createdAt > since ? ok.createdAt : since;
    const failuresSinceOk = failure && (!ok || failure.createdAt > ok.createdAt)
      ? await db.aiCall.count({ where: { provider, outcome: { in: FAILED_OUTCOMES }, createdAt: { gt: after } } })
      : 0;
    out[provider] = {
      lastOkAt: ok?.createdAt.toISOString() ?? null,
      lastFailure: failure ? { at: failure.createdAt.toISOString(), outcome: failure.outcome, errorCode: failure.errorCode, feature: failure.feature } : null,
      failuresSinceOk,
    };
  }));
  return out;
}

/** The same fixed hourly window `generateStructured` counts in (`reserveRateLimit`). */
async function limitHits(now: Date): Promise<HitMap> {
  const windowStart = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  const refused = await db.aiCall.groupBy({
    by: ["feature", "actorUserId"],
    where: { outcome: "RATE_LIMITED", createdAt: { gte: windowStart }, actorUserId: { not: null } },
    _count: { _all: true },
  });
  if (refused.length === 0) return {};
  const userIds = Array.from(new Set(refused.map((row) => row.actorUserId).filter((id): id is string => Boolean(id))));
  const [users, windows] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    db.rateLimitWindow.findMany({ where: { windowStart, key: { in: refused.map((row) => `ai:${row.feature}:user:${row.actorUserId}`) } }, select: { key: true, count: true } }),
  ]);
  const names = new Map(users.map((user) => [user.id, user.name?.trim() || user.email || "A person"]));
  const used = new Map(windows.map((row) => [row.key, row.count]));
  const out: HitMap = {};
  for (const row of refused) {
    if (!row.actorUserId || !AI_FEATURES.includes(row.feature as AiFeature)) continue;
    const feature = row.feature as AiFeature;
    const entry = out[feature] ?? { resetsAt: new Date(windowStart.getTime() + HOUR_MS).toISOString(), people: [] };
    entry.people.push({ name: names.get(row.actorUserId) ?? "A person", used: used.get(`ai:${feature}:user:${row.actorUserId}`) ?? null });
    out[feature] = entry;
  }
  return out;
}

/** Who saved AI settings last, from the settings audit (also used for the 409 "someone else saved first"). */
export async function lastAiSettingsSave(): Promise<AiStatusFacts["lastSaved"]> {
  const row = await db.auditLog.findFirst({
    where: { action: "AI_SETTINGS_UPDATED" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, user: { select: { name: true, email: true } } },
  });
  return row ? { at: row.createdAt.toISOString(), by: row.user?.name?.trim() || row.user?.email || null } : null;
}

async function ollamaFacts(): Promise<AiOllamaFacts> {
  const [settings, resolved] = await Promise.all([getOllamaSettings(), getResolvedVisionProviderConfiguration("ollama")]);
  let host: string | null = null;
  try { host = settings.baseUrl ? new URL(settings.baseUrl).host : null; } catch { host = null; }
  return { configured: resolved.configured, host, textModel: settings.textModel || null, visionModel: settings.visionModel || null, useForText: settings.useForText };
}

/** Each part fails on its own: an unreadable part is null ("Not known"), never zero, none or success. */
export async function getAiStatusFacts(now = new Date()): Promise<AiStatusFacts> {
  const [lastTests, providers, hits, lastSaved, ollama] = await Promise.all([
    latestFeatureTests().catch(() => null),
    providerHealth(now).catch(() => null),
    limitHits(now).catch(() => null),
    lastAiSettingsSave().catch(() => null),
    ollamaFacts().catch(() => null),
  ]);
  return { lastTests, providers, limitHits: hits, lastSaved, ollama };
}
