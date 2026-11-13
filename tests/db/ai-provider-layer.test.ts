// @vitest-environment node
/**
 * AI provider layer on a real, disposable PostgreSQL (127.0.0.1:55439):
 * the shared rate-limit counter is atomic under concurrency, AiCall rows are
 * append-only at the database, and queued feature tests are processed once.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, test: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/ai/vision", () => ({ assignmentJson: {}, assignmentSchema: {}, comparisonJson: {}, comparisonSchema: {} }));
vi.mock("@/lib/ai/provider/generate", () => ({ generateStructured: m.test }));
import { recordAiCall, reserveRateLimit } from "@/lib/ai/provider/store";
import { processAiTaskQueue, queueFeatureTest, readAiTask } from "@/lib/ai/provider/tasks";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `ai-layer-${randomUUID().slice(0, 8)}`;

describe.skipIf(!url)("AI provider layer (database)", () => {
  beforeAll(() => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
  });
  afterAll(async () => {
    if (!m.client) return;
    await m.client.rateLimitWindow.deleteMany({ where: { key: { startsWith: tag } } });
    await m.client.aiTask.deleteMany({ where: { requestedById: tag } });
    await m.client.$disconnect();
  });

  it("allows exactly the limit under 25 concurrent reservations across one window", async () => {
    const now = new Date("2026-11-14T03:10:00Z");
    const results = await Promise.all(Array.from({ length: 25 }, () => reserveRateLimit(`${tag}:burst`, 10, 3_600_000, now)));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await reserveRateLimit(`${tag}:burst`, 10, 3_600_000, new Date("2026-11-14T04:00:01Z"))).toBe(true);
  });

  it("keeps AiCall rows append-only", async () => {
    const id = `${tag}-call`;
    await m.client.aiCall.create({ data: { id, feature: "wording", provider: "ollama", model: "gemma3:4b", latencyMs: 5, outcome: "OK" } });
    await expect(m.client.aiCall.update({ where: { id }, data: { outcome: "INVALID_OUTPUT" } })).rejects.toThrow();
    await expect(m.client.aiCall.delete({ where: { id } })).rejects.toThrow();
    expect(await m.client.aiCall.findUnique({ where: { id } })).toMatchObject({ outcome: "OK" });
    await recordAiCall({ feature: "wording", provider: "ollama", model: "gemma3:4b", actorUserId: tag, agentId: null, entityType: null, entityId: null, inputTokens: 1, outputTokens: 2, imageCount: 0, attempts: 1, latencyMs: 3, outcome: "OK", errorCode: null, costMicroUsd: 0 });
    expect(await m.client.aiCall.count({ where: { actorUserId: tag } })).toBe(1);
  });

  it("processes a queued feature test once and only the requester can read it", async () => {
    m.test.mockResolvedValue({ data: { ok: true, echo: "sneek-test" }, route: { provider: "ollama", model: "gemma3:4b" }, usage: { inputTokens: 3, outputTokens: 4 }, attempts: 1 });
    const task = await queueFeatureTest("wording", tag);
    expect(task.status).toBe("PENDING");
    await processAiTaskQueue();
    await processAiTaskQueue();
    expect(m.test).toHaveBeenCalledTimes(1);
    expect(await readAiTask(task.id, tag)).toMatchObject({ status: "SUCCEEDED", result: { ok: true, provider: "ollama", model: "gemma3:4b" } });
    expect(await readAiTask(task.id, "someone-else")).toBeNull();
  });
});
