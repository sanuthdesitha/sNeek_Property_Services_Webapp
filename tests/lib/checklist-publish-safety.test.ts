// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { JobType } from "@prisma/client";
const m = vi.hoisted(() => ({ property: vi.fn(), library: vi.fn(), create: vi.fn(), previous: vi.fn(), retire: vi.fn(), profile: vi.fn(), audit: vi.fn(), settings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { property: { findUnique: m.property }, formTemplate: { create: m.create, findUnique: m.previous, update: m.retire }, propertyChecklistProfile: { update: m.profile }, auditLog: { create: m.audit } } }));
vi.mock("@/lib/checklists/library", () => ({ getChecklistLibrary: m.library }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings, saveAppSettings: m.saveSettings }));
import { sanitizeSelections, composeFormSchema, generatePropertyTemplates } from "@/lib/checklists/compose";
const item = (key: string) => ({ id: key, key, label: key, instructions: null, fieldType: "photo", required: false, defaultOn: true, jobTypes: [], appliesWhen: null, isActive: true, frequency: "ROTATIONAL", rotationEveryNCleans: 4 });
const library: any = [{ id: "room", key: "room", title: "Room", category: "ROOM", repeatBy: "bedrooms", items: [item("reviewed"), item("new-standard")] }];
const selections = { modules: { room: { enabled: true, items: { reviewed: { enabled: true, rotationEveryNCleans: 3, instructions: "Property-specific" } } } }, customItems: [] };
beforeEach(() => { vi.resetAllMocks(); m.library.mockResolvedValue(library); m.property.mockResolvedValue({ id: "p", name: "Home", bedrooms: 2, checklistProfile: { selections, generatedTemplateIds: { AIRBNB_TURNOVER: "old" } } }); m.previous.mockResolvedValue({ id: "old", version: 2 }); m.create.mockResolvedValue({ id: "new" }); m.settings.mockResolvedValue({ propertyFormTemplateOverrides: { elsewhere: { DEEP_CLEAN: "keep" } } }); });
it("publishes only reviewed selections and full rotational catalogue, preserving unrelated overrides", async () => {
 expect(await generatePropertyTemplates({ propertyId: "p", actorUserId: "a", jobTypes: [JobType.AIRBNB_TURNOVER] })).toEqual({ generated: { AIRBNB_TURNOVER: "new" } });
 const created = m.create.mock.calls[0][0].data;
 const fields = created.schema.sections.flatMap((section: any) => section.fields);
 expect(fields.filter((field: any) => field.id.startsWith("reviewed"))).toHaveLength(2);
 expect(fields.some((field: any) => field.id.includes("new-standard"))).toBe(false);
 expect(fields.find((field: any) => field.id.startsWith("reviewed"))).toMatchObject({ instructions: "Property-specific", rotationEveryNCleans: 3 });
 expect(created).toMatchObject({ version: 3, parentTemplateId: "old" }); expect(m.retire).toHaveBeenCalled();
 expect(m.saveSettings.mock.calls[0][0].propertyFormTemplateOverrides).toMatchObject({ elsewhere: { DEEP_CLEAN: "keep" }, p: { AIRBNB_TURNOVER: "new" } });
});
it.each([null, { id: "p", checklistProfile: null }])("requires property and reviewed profile before publishing %j", async property => {
 m.property.mockResolvedValue(property); await expect(generatePropertyTemplates({ propertyId: "p", actorUserId: "a", jobTypes: [JobType.DEEP_CLEAN] })).rejects.toThrow(); expect(m.create).not.toHaveBeenCalled();
});
it("sanitizes cadence and property instructions, retaining valid3/4 only", () => {
 const result = sanitizeSelections({ modules: { room: { enabled: true, items: { a: { enabled: true, rotationEveryNCleans: 3, instructions: " plant " }, b: { enabled: true, rotationEveryNCleans: 4, instructions: "x".repeat(2100) }, c: { enabled: true, rotationEveryNCleans: 5, instructions: " " } } } } });
 expect(result.modules.room.items.a).toMatchObject({ rotationEveryNCleans: 3, instructions: "plant" }); expect(result.modules.room.items.b.instructions).toHaveLength(2000); expect(result.modules.room.items.c).not.toHaveProperty("rotationEveryNCleans"); expect(result.modules.room.items.c).not.toHaveProperty("instructions");
});
it("attaches custom tasks only to their selected room and once across repeated rooms", () => {
 const schema = composeFormSchema(library, { ...selections, customItems: [{ id: "plant", moduleKey: "room", label: "Check plant", requiresPhoto: true }, { id: "other", moduleKey: "elsewhere", label: "Elsewhere" }] }, JobType.AIRBNB_TURNOVER, { bedrooms: 2 } as any, { includeRotational: true });
 const fields = schema.sections.flatMap(section => section.fields);
 expect(fields.filter(field => field.label === "Check plant")).toHaveLength(1); expect(fields.filter(field => field.label === "Elsewhere")).toHaveLength(1);
});
