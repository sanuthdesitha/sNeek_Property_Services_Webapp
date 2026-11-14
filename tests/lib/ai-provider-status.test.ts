// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  aiTask: { findFirst: vi.fn() },
  aiCall: { findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  user: { findMany: vi.fn() },
  rateLimitWindow: { findMany: vi.fn() },
  auditLog: { findFirst: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/config", () => ({ getResolvedVisionProviderConfiguration: async () => ({ configured: true }) }));
vi.mock("@/lib/ai/ollama-settings", () => ({ getOllamaSettings: async () => ({ baseUrl: "http://sneek-ollama:11434/v1", textModel: "llama3.1:8b", visionModel: "qwen2.5vl:7b", useForText: false, apiKey: "secret" }) }));

import { getAiStatusFacts } from "@/lib/ai/provider/status";

const NOW = new Date("2026-11-14T03:40:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  db.aiTask.findFirst.mockResolvedValue(null);
  db.aiCall.findFirst.mockResolvedValue(null);
  db.aiCall.count.mockResolvedValue(0);
  db.aiCall.groupBy.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
  db.rateLimitWindow.findMany.mockResolvedValue([]);
  db.auditLog.findFirst.mockResolvedValue(null);
});

describe("getAiStatusFacts", () => {
  it("reports the latest test per feature with the audit's technical detail for a failure", async () => {
    db.aiTask.findFirst.mockImplementation(async ({ where }: { where: { feature: string } }) => (where.feature === "draft_reply"
      ? { status: "FAILED", createdAt: new Date("2026-11-14T03:00:00Z"), finishedAt: new Date("2026-11-14T03:00:05Z"), error: "The provider did not return a usable result.", result: { ok: false, message: "The provider did not return a usable result.", provider: "", model: "", durationMs: 900 } }
      : null));
    db.aiCall.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.entityType === "AiFeatureTest" ? { outcome: "PROVIDER_ERROR", errorCode: "AUTH", provider: "openai_compatible" } : null));
    const facts = await getAiStatusFacts(NOW);
    expect(facts.lastTests?.draft_reply).toMatchObject({ status: "FAILED", ok: false, provider: null, detail: "AUTH · openai_compatible", at: "2026-11-14T03:00:05.000Z" });
    expect(facts.lastTests?.wording).toBeUndefined();
  });

  it("counts failures after the last success per provider and names nothing it did not record", async () => {
    db.aiCall.findFirst.mockImplementation(async ({ where }: { where: { provider?: string; outcome?: unknown } }) => {
      if (where.provider !== "openai_compatible") return null;
      return where.outcome === "OK" ? { createdAt: new Date("2026-11-12T00:00:00Z") } : { createdAt: new Date("2026-11-14T02:00:00Z"), outcome: "PROVIDER_ERROR", errorCode: "AUTH", feature: "draft_reply" };
    });
    db.aiCall.count.mockResolvedValue(4);
    const facts = await getAiStatusFacts(NOW);
    expect(facts.providers?.openai_compatible).toEqual({ lastOkAt: "2026-11-12T00:00:00.000Z", lastFailure: { at: "2026-11-14T02:00:00.000Z", outcome: "PROVIDER_ERROR", errorCode: "AUTH", feature: "draft_reply" }, failuresSinceOk: 4 });
    expect(facts.providers?.anthropic).toBeUndefined();
  });

  it("lists who reached an hourly limit in the current window with the count used, and when it resets", async () => {
    db.aiCall.groupBy.mockResolvedValue([{ feature: "assistant", actorUserId: "u1", _count: { _all: 2 } }]);
    db.user.findMany.mockResolvedValue([{ id: "u1", name: "Chloe Martin", email: "c@example.com" }]);
    db.rateLimitWindow.findMany.mockResolvedValue([{ key: "ai:assistant:user:u1", count: 60 }]);
    const facts = await getAiStatusFacts(NOW);
    expect(facts.limitHits?.assistant).toEqual({ resetsAt: "2026-11-14T04:00:00.000Z", people: [{ name: "Chloe Martin", used: 60 }] });
    expect(db.rateLimitWindow.findMany.mock.calls[0][0].where.windowStart).toEqual(new Date("2026-11-14T03:00:00.000Z"));
  });

  it("gives the Ollama host and models only, and the last settings save", async () => {
    db.auditLog.findFirst.mockResolvedValue({ createdAt: new Date("2026-11-14T03:20:00Z"), user: { name: "Hannah Lee", email: "h@example.com" } });
    const facts = await getAiStatusFacts(NOW);
    expect(facts.ollama).toEqual({ configured: true, host: "sneek-ollama:11434", textModel: "llama3.1:8b", visionModel: "qwen2.5vl:7b", useForText: false });
    expect(JSON.stringify(facts)).not.toContain("secret");
    expect(facts.lastSaved).toEqual({ at: "2026-11-14T03:20:00.000Z", by: "Hannah Lee" });
  });

  it("returns null for a part that cannot be read instead of an empty answer", async () => {
    db.aiCall.groupBy.mockRejectedValue(new Error("db down"));
    db.aiTask.findFirst.mockRejectedValue(new Error("db down"));
    const facts = await getAiStatusFacts(NOW);
    expect(facts.limitHits).toBeNull();
    expect(facts.lastTests).toBeNull();
  });
});
