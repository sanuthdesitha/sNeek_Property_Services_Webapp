// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn(), moduleUpsert: vi.fn(), itemUpsert: vi.fn(), find: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { checklistModule: { findMany: m.read, upsert: m.moduleUpsert, findUnique: m.find }, checklistModuleItem: { upsert: m.itemUpsert, updateMany: m.updateMany, deleteMany: m.deleteMany } } }));
import { getChecklistLibrary, seedChecklistLibraryFromCatalog } from "@/lib/checklists/library";
beforeEach(() => { vi.resetAllMocks(); m.read.mockResolvedValue([]); m.moduleUpsert.mockImplementation(async ({ create }) => ({ id: create.key })); m.find.mockResolvedValue({ id: "room" }); });
it("empty library read never seeds or updates", async () => { expect(await getChecklistLibrary()).toEqual([]); expect(m.moduleUpsert).not.toHaveBeenCalled(); expect(m.itemUpsert).not.toHaveBeenCalled(); });
it("explicit seed is additive and never overwrites/removes authored rows", async () => {
  await seedChecklistLibraryFromCatalog();
  expect(m.moduleUpsert).toHaveBeenCalled(); expect(m.itemUpsert).toHaveBeenCalled();
  for (const [args] of [...m.moduleUpsert.mock.calls, ...m.itemUpsert.mock.calls]) expect(args.update).toEqual({});
  expect(m.updateMany).not.toHaveBeenCalled(); expect(m.deleteMany).not.toHaveBeenCalled();
});
it("inactive library inspection remains read-only", async () => {
 await getChecklistLibrary({ includeInactive: true });
 expect(m.read).toHaveBeenCalledWith(expect.objectContaining({ where: {}, include: { items: { where: {}, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } }));
 expect(m.moduleUpsert).not.toHaveBeenCalled();
});
it("does not orphan evidence items when their room module is missing", async () => {
 m.find.mockResolvedValue(null); await seedChecklistLibraryFromCatalog();
 expect(m.itemUpsert.mock.calls.every(([args]) => args.create.moduleId != null)).toBe(true);
 expect(m.itemUpsert.mock.calls.some(([args]) => args.create.frequency === "ROTATIONAL")).toBe(false);
});
