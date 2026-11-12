// @vitest-environment node
// Wave B library: server-side Compare (pure), Export / Import rules and the
// import service (never overwrites, never publishes, drafts only).
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), audit: vi.fn(), draft: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => {
  const formTemplate = { create: m.create, update: m.update, updateMany: m.update, upsert: m.update, findMany: m.findMany, findUnique: m.findUnique };
  const tx = { formTemplate, auditLog: { create: m.audit } };
  return { db: { ...tx, $transaction: (run: (t: unknown) => unknown) => run(tx) } };
});
vi.mock("@/lib/forms/template-drafts", () => ({ readTemplateDraft: m.draft }));
import { compareTemplates, copyableEdit } from "@/lib/forms/template-compare";
import { buildExportFile, fixCollidingIds, importedName, parseImportFile, IMPORT_MAX_FORMS, TRANSFER_FORMAT } from "@/lib/forms/template-transfer";
import { exportFormTemplates, importFormTemplates } from "@/lib/forms/template-transfer-server";

const kitchen = (fields: unknown[]) => ({ sections: [{ id: "k", title: "Kitchen", fields }] });
const oven = { id: "oven", type: "yesno", label: "Oven cleaned inside", required: true };
const photo = { id: "p", type: "photo", label: "Photo of oven", minPhotos: 1 };

describe("compareTemplates", () => {
  const forms = [
    { id: "a", name: "Standard", version: 14, source: "live" as const, schema: kitchen([oven, photo]) },
    { id: "b", name: "Jackson P3", version: 6, source: "draft" as const, schema: kitchen([{ ...oven, id: "x1", required: false, frequency: "MONTHLY" }, { id: "z", type: "text", label: "  photo OF oven " }]) },
    { id: "c", name: "Studio", version: 3, source: "live" as const, schema: kitchen([oven, photo, photo]) },
  ];
  const result = compareTemplates(forms);
  const row = (label: string, type: string) => result.sections[0].rows.find((r) => r.label.toLowerCase().includes(label) && r.type === type)!;

  it("matches by section, wording and type (ids ignored) and names what changed", () => {
    const ovenRow = row("oven cleaned", "yesno");
    expect(ovenRow.cells.map((c) => c.state)).toEqual(["reference", "changed", "same"]);
    expect(ovenRow.cells[1].changed.map((c) => c.label)).toEqual(["Required", "How often"]);
    expect(ovenRow.cells[1].values.frequency).toBe("Monthly");
  });
  it("marks missing, added and repeated in text", () => {
    expect(row("photo of oven", "photo").cells.map((c) => c.state)).toEqual(["reference", "missing", "repeated"]);
    expect(row("photo of oven", "text").cells.map((c) => c.state)).toEqual(["missing", "added", "missing"]);
    expect(result.summary).toEqual({ questions: 3, differing: 3 });
  });
  it("refuses fewer than 2 or more than 4 forms, and copies only bulk-editable settings", () => {
    expect(() => compareTemplates(forms.slice(0, 1))).toThrow();
    expect(copyableEdit("required", oven)).toEqual({ property: "required", value: true });
    expect(copyableEdit("options", oven)).toBeNull();
    expect(result.properties.find((p) => p.key === "required")?.copyable).toBe(true);
    expect(result.properties.find((p) => p.key === "conditional")?.copyable).toBe(false);
  });
});

describe("export and import rules", () => {
  const schema = { theme: { logoKey: "logo.png", logoUrl: "https://s3.invalid/logo.png?X-Amz-Signature=secret" },
    sections: [{ id: "k", title: "Kitchen", fields: [{ ...photo, references: [{ kind: "image", storageKey: "ref.jpg", url: "https://s3.invalid/ref.jpg?X-Amz-Signature=secret" }, { kind: "link", url: "https://example.invalid/how" }] }] }] };
  const file = buildExportFile([{ name: "Standard", serviceType: "AIRBNB_TURNOVER", tags: ["Jackson"], source: "live", sourceVersion: 4, schema }], new Date("2026-11-12T00:00:00Z"));
  const text = JSON.stringify(file);

  it("exports no ids, no presigned links, and a format version", () => {
    expect(file).toMatchObject({ format: TRANSFER_FORMAT, formatVersion: 1 });
    expect(text).not.toContain("X-Amz-Signature");
    expect(text).toContain("ref.jpg");
    expect(text).toContain("https://example.invalid/how");
    expect(Object.keys(file.forms[0]).sort()).toEqual(["name", "schema", "serviceType", "source", "sourceVersion", "tags"]);
  });
  it("round-trips through the strict import check", () => {
    const parsed = parseImportFile(text, ["AIRBNB_TURNOVER"]);
    expect(parsed.ok && parsed.forms[0]).toMatchObject({ name: "Standard", refused: null, questions: 1, tags: ["Jackson"] });
  });
  it("refuses unknown types with the reason, bad files, and over-cap files", () => {
    const bad = { ...file, forms: [{ ...file.forms[0], schema: kitchen([{ id: "g", type: "grid", label: "Grid" }]) }, { ...file.forms[0], serviceType: "SPACE_CLEAN" }] };
    const parsed = parseImportFile(JSON.stringify(bad), ["AIRBNB_TURNOVER"]);
    expect(parsed.ok && parsed.forms[0].refused).toMatch(/question type no form can show \(grid\)/);
    expect(parsed.ok && parsed.forms[1].refused).toMatch(/Unknown service type/);
    expect(parseImportFile("{nope", [])).toEqual({ ok: false, error: "The file is not valid JSON." });
    expect(parseImportFile(JSON.stringify({ ...file, formatVersion: 2 }), []).ok).toBe(false);
    expect(parseImportFile(JSON.stringify({ ...file, forms: Array.from({ length: IMPORT_MAX_FORMS + 1 }, () => file.forms[0]) }), ["AIRBNB_TURNOVER"]).ok).toBe(false);
    expect(parseImportFile("x".repeat(1_000_001), []).ok).toBe(false);
  });
  it("renames ids only on a collision inside one form, keeping conditions on the first holder", () => {
    const fixed = fixCollidingIds(kitchen([oven, { ...oven, label: "Again" }, { id: "w", type: "text", label: "Why", conditional: { fieldId: "oven", value: false } }]));
    const ids = (fixed.schema as any).sections[0].fields.map((f: { id: string }) => f.id);
    expect(ids).toEqual(["oven", "oven_2", "w"]);
    expect(fixed.renamed).toBe(1);
    expect((fixed.schema as any).sections[0].fields[2].conditional.fieldId).toBe("oven");
    expect(importedName("Standard", ["standard", "Standard (imported)"])).toBe("Standard (imported 2)");
  });
});

describe("import and export services", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.findMany.mockResolvedValue([{ name: "Standard", version: 7 }]);
    m.create.mockImplementation(async ({ data }) => ({ id: `new-${data.name}`, name: data.name }));
  });
  const text = JSON.stringify(buildExportFile([
    { name: "Standard", serviceType: "AIRBNB_TURNOVER", tags: [], source: "live", sourceVersion: 1, schema: kitchen([oven]) },
    { name: "Broken", serviceType: "AIRBNB_TURNOVER", tags: [], source: "live", sourceVersion: 1, schema: kitchen([{ id: "g", type: "grid", label: "G" }]) },
  ], new Date()));

  it("a dry run creates nothing", async () => {
    const outcome = await importFormTemplates({ text, dryRun: true, actorId: "admin" });
    expect(outcome).toMatchObject({ dryRun: true, created: 0, refused: 1 });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("creates new drafts only: never updates an existing form, never live", async () => {
    const outcome = await importFormTemplates({ text, dryRun: false, actorId: "admin" });
    expect(outcome.created).toBe(1);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0][0].data).toMatchObject({ name: "Standard (imported)", isActive: false, kind: "CUSTOM", version: 8 });
    expect(m.create.mock.calls[0][0].data.id).toBeUndefined();
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "FORM_TEMPLATE_IMPORTED" }) }));
  });
  it("exports the draft when a form has one", async () => {
    m.findMany.mockResolvedValue([{ id: "a", name: "Live name", version: 3, schema: kitchen([oven]), serviceType: "AIRBNB_TURNOVER", tags: ["x"] }]);
    m.draft.mockResolvedValue({ name: "Draft name", schema: kitchen([photo]), serviceType: null });
    const file = await exportFormTemplates(["a"], new Date("2026-11-12T00:00:00Z"));
    expect(file.forms[0]).toMatchObject({ name: "Draft name", source: "draft", sourceVersion: 3, tags: ["x"] });
  });
});
