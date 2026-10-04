// @vitest-environment node
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ global: vi.fn<(...args: any[]) => any>(() => { throw new Error("Global DB access is not allowed"); }), maintenance: vi.fn(), migrate: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { issueTicket: { create: mocks.global, findUnique: mocks.global } } }));
vi.mock("@/lib/phase4/store", () => ({ readSettingStore: mocks.migrate, writeSettingStore: mocks.migrate }));
vi.mock("@/lib/phase4/disputes", () => ({ listDisputes: mocks.migrate }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://media.invalid/${key}` }));
vi.mock("@/lib/cases/damage-maintenance-sync", () => ({ autoCreateMaintenanceForDamageCase: mocks.maintenance, createDamageMaintenanceInTransaction: vi.fn(), syncMaintenanceFromCase: vi.fn() }));
import { createCase } from "@/lib/cases/service";
it("creates and reads inside the transaction, deferring maintenance until commit", async () => {
  const row = { id: "case", title: "Damage", caseType: "DAMAGE", severity: "HIGH", status: "OPEN", propertyId: "property", jobId: "job", metadata: {} };
  const tx = { issueTicket: { create: vi.fn().mockResolvedValue(row), findUnique: vi.fn().mockResolvedValue(row) } };
  const afterCommit: Array<() => Promise<unknown>> = [];
  const result = await createCase({ title: "Damage", caseType: "DAMAGE", propertyId: "property", jobId: "job" }, { transaction: tx as any, afterCommit });
  expect(result?.id).toBe("case");
  expect(tx.issueTicket.create).toHaveBeenCalledTimes(1); expect(tx.issueTicket.findUnique).toHaveBeenCalledTimes(1);
  expect(mocks.global).not.toHaveBeenCalled(); expect(mocks.migrate).not.toHaveBeenCalled();
  expect(mocks.maintenance).not.toHaveBeenCalled(); expect(afterCommit).toHaveLength(1);
  await afterCommit[0](); expect(mocks.maintenance).toHaveBeenCalledTimes(1);
});
it("requires a delivery queue when a transaction is provided", async () => {
  await expect(createCase({ title: "Damage" }, { transaction: {} as any })).rejects.toThrow("after-commit queue");
});
it("awaits mandatory maintenance before returning a standalone case", async () => {
 const row = { id: "standalone", title: "Damage", caseType: "DAMAGE", severity: "HIGH", status: "OPEN", propertyId: "property", jobId: "job", metadata: {} };
 const events: string[] = [];
 mocks.global.mockImplementationOnce(async () => { events.push("create"); return row; }).mockImplementationOnce(async () => { events.push("read"); return row; });
 mocks.migrate.mockResolvedValueOnce({ data: { migratedIds: [] } }).mockResolvedValueOnce([]);
 mocks.maintenance.mockImplementationOnce(async () => { events.push("maintenance"); });
 expect((await createCase({ title: "Damage", caseType: "DAMAGE", propertyId: "property", jobId: "job" }))?.id).toBe("standalone");
 expect(events).toEqual(["create", "maintenance", "read"]);
});
