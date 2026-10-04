// @vitest-environment node
import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ modules: vi.fn(), items: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { checklistModule: { upsert: m.modules, findUnique: vi.fn().mockResolvedValue({ id: "room" }) }, checklistModuleItem: { upsert: m.items } } }));
vi.mock("@/lib/checklists/catalog", async importOriginal => {
 const actual = await importOriginal<any>();
 return { ...actual,
  DEFAULT_CHECKLISTS: {
   invalid: { jobType: "UNKNOWN", sections: [] },
   first: { jobType: "AIRBNB_TURNOVER", sections: [{ id: "legacy", items: [{ id: "balcony", label: "Balcony" }, { id: "detail", label: "Detail", instructions: "Short" }] }] },
   second: { jobType: "DEEP_CLEAN", sections: [{ id: "legacy", title: "Legacy", items: [{ id: "balcony", label: "Balcony", instructions: "Check railings" }, { id: "detail", label: "Detail", instructions: "Longer approved directions" }] }] },
  },
  ROTATIONAL_EVIDENCE_ITEMS: actual.ROTATIONAL_EVIDENCE_ITEMS.map((item: any) => ({ ...item, evidenceCategory: undefined })),
  MANDATORY_EVIDENCE_ITEMS: actual.MANDATORY_EVIDENCE_ITEMS.map((item: any) => ({ ...item, jobTypes: undefined, evidenceCategory: undefined })),
  STANDARD_AIRBNB_ITEMS: actual.STANDARD_AIRBNB_ITEMS.map((item: any) => ({ ...item, stampTag: undefined, jobTypes: undefined, evidenceCategory: undefined })),
 };
});
import { seedChecklistLibraryFromCatalog } from "@/lib/checklists/library";
it("preserves additive seeding with incomplete legacy metadata and aggregates shared work across job types", async () => {
 m.modules.mockImplementation(async ({ create }) => ({ id: create.key }));
 await seedChecklistLibraryFromCatalog();
 const legacy = m.modules.mock.calls.find(([args]) => args.create.key === "legacy")![0];
 expect(legacy.create.title).toBe("legacy"); expect(legacy.update).toEqual({});
 const balcony = m.items.mock.calls.find(([args]) => args.create.key === "balcony")![0];
 expect(balcony.create).toMatchObject({ instructions: "Check railings", appliesWhen: { propertyField: "hasBalcony", equals: true }, jobTypes: ["AIRBNB_TURNOVER", "DEEP_CLEAN"] });
 expect(m.items.mock.calls.find(([args]) => args.create.key === "detail")![0].create.instructions).toBe("Longer approved directions");
 expect(m.items.mock.calls.every(([args]) => Object.keys(args.update).length === 0)).toBe(true);
});
