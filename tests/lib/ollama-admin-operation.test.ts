// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn(), remove: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: async (fn: any) => fn({ $executeRaw: mock.lock, appSetting: { findUnique: mock.find, upsert: mock.upsert } }), appSetting: { deleteMany: mock.remove } } }));
import { acquireOllamaOperation } from "@/lib/ai/ollama-admin-operation";
beforeEach(() => { vi.clearAllMocks(); mock.find.mockResolvedValue(null); mock.upsert.mockResolvedValue({}); mock.remove.mockResolvedValue({ count: 1 }); });
it("claims a bounded persisted lease and releases only its own token", async () => {
 const release = await acquireOllamaOperation(60_000);
 const args = mock.upsert.mock.calls[0][0];
 expect(mock.lock).toHaveBeenCalledTimes(1);
 expect(args.create.value.expires).toBeGreaterThan(Date.now());
 expect(args.create.value.expires).toBeLessThanOrEqual(Date.now() + 60_000);
 await release();
 expect(mock.remove).toHaveBeenCalledWith({ where: { key: "ai_ollama_setup_operation_v1", value: { path: ["token"], equals: args.create.value.token } } });
});
it("rejects simultaneous diagnostics, downloads and saves before mutations", async () => {
 mock.find.mockResolvedValue({ value: { token: "other", expires: Date.now() + 10000 } });
 await expect(acquireOllamaOperation(60000)).rejects.toThrow("OLLAMA_BUSY"); expect(mock.upsert).not.toHaveBeenCalled();
});
it("allows recovery after an expired worker lease", async () => {
 mock.find.mockResolvedValue({ value: { token: "lost", expires: Date.now() - 1 } });
 await acquireOllamaOperation(60000); expect(mock.upsert.mock.calls[0][0].update.value.token).not.toBe("lost");
});
it("fails closed when the database cannot claim the operation", async () => {
 mock.find.mockRejectedValue(new Error("database unavailable")); await expect(acquireOllamaOperation(60000)).rejects.toThrow(); expect(mock.upsert).not.toHaveBeenCalled();
});
