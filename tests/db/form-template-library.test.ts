// @vitest-environment node
/**
 * Forms library against a real, disposable PostgreSQL (127.0.0.1:55439):
 * drafts never change what jobs resolve to, publish and restore keep history,
 * bulk dry runs change nothing, bulk applies report per form, groups.
 * Run with SNEEK_TEST_DATABASE_URL pointing at a migrated disposable database.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }),
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", propertyFormTemplateOverrides: {} }) }));

import { readTemplateDraft, restoreTemplateVersion, saveTemplateDraft } from "@/lib/forms/template-drafts";
import { publishFormTemplate } from "@/lib/forms/template-publish";
import { resolveEffectiveJobForm } from "@/lib/forms/resolve-effective-job-form";
import { runBulkTemplateOperation } from "@/lib/forms/template-bulk";
import { createFormGroup, deleteFormGroup, listFormGroups } from "@/lib/forms/template-groups";
import { listFormLibrary } from "@/lib/forms/library-list";
import { listTemplateVersionHistory } from "@/lib/forms/template-history";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `fl-${randomUUID().slice(0, 8)}`;
const actor = randomUUID();
const ids = { a: `${tag}-a`, b: `${tag}-b`, c: `${tag}-c` };

function formSchema(label: string, extra: Array<Record<string, unknown>> = []) {
  return {
    standardSections: false,
    sections: [{ id: "kitchen", title: "Kitchen", fields: [{ id: "oven", type: "photo", label, required: true, minPhotos: 1 }, ...extra] }],
  };
}

async function liveSchemas() {
  const rows = await m.client.formTemplate.findMany({ where: { id: { startsWith: tag } }, orderBy: { id: "asc" }, select: { id: true, schema: true, version: true, updatedAt: true } });
  return JSON.stringify(rows);
}

async function resolvedLabel(templateId: string) {
  const job = { jobType: "LAWN_MOWING" as const, propertyId: "no-property", formTemplateId: templateId, isRework: false, internalNotes: null, property: { name: "Fixture" } };
  const resolved = await resolveEffectiveJobForm(job, { propertyFormTemplateOverrides: {} });
  const sections = (resolved.template?.schema as { sections: Array<{ id: string; fields: Array<{ id: string; label: string }> }> }).sections;
  return sections.find((s) => s.id === "kitchen")?.fields.find((f) => f.id === "oven")?.label;
}

describe.skipIf(!url)("forms library on PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Disposable loopback database on 55439 required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.create({ data: { id: actor, email: `${actor}@example.invalid`, role: "ADMIN" } });
  });

  beforeEach(async () => {
    await m.client.formTemplate.deleteMany({ where: { id: { startsWith: tag } } });
    await m.client.formTemplateGroup.deleteMany({ where: { name: { startsWith: tag } } });
    // Two live forms for a job type nothing else uses (LAWN_MOWING) and one draft.
    await m.client.formTemplate.createMany({
      data: [
        { id: ids.a, name: `${tag} Alpha`, serviceType: "LAWN_MOWING", version: 1, isActive: true, schema: formSchema("Oven cleaned inside") },
        { id: ids.b, name: `${tag} Bravo`, serviceType: "GUTTER_CLEANING", version: 1, isActive: true, schema: { standardSections: false, sections: [{ id: "roof", title: "Roof", fields: [{ id: "gutter", type: "checkbox", label: "Gutters clear", required: true }] }] } },
        { id: ids.c, name: `${tag} Charlie`, serviceType: "GUTTER_CLEANING", version: 1, isActive: false, schema: formSchema("Oven cleaned inside") },
      ],
    });
    await m.client.formTemplateVersion.createMany({
      data: [ids.a, ids.b, ids.c].map((templateId) => ({ templateId, kind: "PUBLISHED" as const, version: 1, schema: formSchema("Oven cleaned inside"), note: "fixture baseline" })),
    });
  });

  afterAll(async () => {
    if (!m.client) return;
    await m.client.formTemplate.deleteMany({ where: { id: { startsWith: tag } } });
    await m.client.formTemplate.deleteMany({ where: { name: { startsWith: tag } } });
    await m.client.formTemplateGroup.deleteMany({ where: { name: { startsWith: tag } } });
    await m.client.auditLog.deleteMany({ where: { userId: actor } });
    await m.client.user.delete({ where: { id: actor } });
    await m.client.$disconnect();
  });

  it("a saved draft never changes the live schema or what a job resolves to", async () => {
    const before = await liveSchemas();
    await saveTemplateDraft({ templateId: ids.a, schema: formSchema("Oven and racks cleaned"), actorId: actor });
    expect(await liveSchemas()).toBe(before);
    expect(await resolvedLabel(ids.a)).toBe("Oven cleaned inside");
    expect((await readTemplateDraft(ids.a))?.baseVersion).toBe(1);
  });

  it("refuses a save from a stale editor and keeps one draft per form", async () => {
    const template = await m.client.formTemplate.findUniqueOrThrow({ where: { id: ids.a } });
    const first = await saveTemplateDraft({ templateId: ids.a, schema: formSchema("One"), actorId: actor, expectedToken: template.updatedAt.toISOString() });
    // The editor still holds the template's token; the draft has moved on.
    await expect(saveTemplateDraft({ templateId: ids.a, schema: formSchema("Two"), actorId: actor, expectedToken: template.updatedAt.toISOString() })).rejects.toMatchObject({ code: "STALE_TEMPLATE" });
    await saveTemplateDraft({ templateId: ids.a, schema: formSchema("Three"), actorId: actor, expectedToken: first.token });
    expect(await m.client.formTemplateVersion.count({ where: { templateId: ids.a, kind: "DRAFT" } })).toBe(1);
  });

  it("publishing makes the draft live as a new version and records it", async () => {
    await saveTemplateDraft({ templateId: ids.a, schema: formSchema("Oven and racks cleaned"), actorId: actor, note: "Racks too" });
    const result = await publishFormTemplate({ templateId: ids.a, actorId: actor });
    expect(result.publishedVersion).toBe(2);
    expect(result.template.version).toBe(2);
    expect(await resolvedLabel(ids.a)).toBe("Oven and racks cleaned");
    expect(await readTemplateDraft(ids.a)).toBeNull();
    const history = await listTemplateVersionHistory(ids.a);
    expect(history.versions.map((v) => [v.version, v.note])).toEqual([[2, "Racks too"], [1, "fixture baseline"]]);
  });

  it("restore makes an old version the draft without rewriting history", async () => {
    await saveTemplateDraft({ templateId: ids.a, schema: formSchema("Changed"), actorId: actor });
    await publishFormTemplate({ templateId: ids.a, actorId: actor });
    const v1 = await m.client.formTemplateVersion.findFirstOrThrow({ where: { templateId: ids.a, kind: "PUBLISHED", version: 1 } });
    const restored = await restoreTemplateVersion({ templateId: ids.a, versionId: v1.id, actorId: actor, replaceDraft: false });
    expect(restored.draft.note).toBe("Restored from v1");
    expect(await resolvedLabel(ids.a)).toBe("Changed");
    expect(await m.client.formTemplateVersion.count({ where: { templateId: ids.a, kind: "PUBLISHED" } })).toBe(2);
    await expect(restoreTemplateVersion({ templateId: ids.a, versionId: v1.id, actorId: actor, replaceDraft: false })).rejects.toMatchObject({ code: "DRAFT_EXISTS" });
    await publishFormTemplate({ templateId: ids.a, actorId: actor });
    expect(await resolvedLabel(ids.a)).toBe("Oven cleaned inside");
    expect((await m.client.formTemplate.findUniqueOrThrow({ where: { id: ids.a } })).version).toBe(3);
  });

  it("a bulk dry run changes nothing and previews per form", async () => {
    const before = await liveSchemas();
    const operation = { type: "edit-question" as const, match: { kind: "wording" as const, section: "Kitchen", label: "oven cleaned inside", type: "photo" }, edit: { property: "minPhotos" as const, value: 2 } };
    const preview = await runBulkTemplateOperation({ templateIds: [ids.a, ids.b, "missing"], operation, dryRun: true, actorId: actor });
    expect(await liveSchemas()).toBe(before);
    expect(await m.client.formTemplateVersion.count({ where: { templateId: { startsWith: tag }, kind: "DRAFT" } })).toBe(0);
    expect(preview.outcomes.map((o) => [o.templateId, o.status])).toEqual([[ids.a, "would-change"], [ids.b, "unchanged"], ["missing", "refused"]]);
    expect(preview.outcomes[0].changes[0]).toMatchObject({ fieldId: "oven", before: 1, after: 2 });
    expect(preview.outcomes[1].reason).toMatch(/not in this form/);
  });

  it("a bulk apply saves drafts only for matching forms and leaves the live forms alone", async () => {
    const before = await liveSchemas();
    const result = await runBulkTemplateOperation({
      templateIds: [ids.a, ids.b],
      operation: { type: "find-replace", find: "Oven", replace: "Stove", matchCase: true },
      dryRun: false,
      actorId: actor,
    });
    expect(result.outcomes.map((o) => o.status)).toEqual(["changed", "unchanged"]);
    expect(result.summary).toEqual({ changed: 1, unchanged: 1, refused: 0 });
    expect(await liveSchemas()).toBe(before);
    const draft = (await readTemplateDraft(ids.a))?.schema as ReturnType<typeof formSchema>;
    expect(draft.sections[0].fields[0]).toMatchObject({ id: "oven", label: "Stove cleaned inside" });
    expect(await m.client.auditLog.count({ where: { userId: actor, action: "BULK_FORM_TEMPLATES" } })).toBeGreaterThan(0);
  });

  it("bulk publish refuses two defaults for one job type and publishes the rest", async () => {
    await saveTemplateDraft({ templateId: ids.b, schema: formSchema("Gutter oven?"), actorId: actor });
    const conflict = await runBulkTemplateOperation({ templateIds: [ids.b, ids.c], operation: { type: "publish" }, dryRun: false, actorId: actor });
    expect(conflict.outcomes.map((o) => o.status)).toEqual(["refused", "refused"]);
    const single = await runBulkTemplateOperation({ templateIds: [ids.a, ids.b], operation: { type: "publish" }, dryRun: false, actorId: actor });
    expect(single.outcomes.map((o) => o.status)).toEqual(["unchanged", "changed"]);
  });

  it("groups organise forms and deleting a group only ungroups them", async () => {
    const group = await createFormGroup({ name: `${tag} Deep clean` });
    await expect(createFormGroup({ name: `${tag} deep CLEAN` })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const moved = await runBulkTemplateOperation({ templateIds: [ids.a, ids.b], operation: { type: "move-to-group", groupId: group.id }, dryRun: false, actorId: actor });
    expect(moved.summary.changed).toBe(2);
    expect((await listFormGroups()).find((g) => g.id === group.id)?.formCount).toBe(2);
    expect(await deleteFormGroup(group.id)).toEqual({ ungrouped: 2 });
    expect(await m.client.formTemplate.count({ where: { id: { in: [ids.a, ids.b] }, groupId: null } })).toBe(2);
  });

  it("the library list pages, sorts, searches questions and counts for real", async () => {
    // A draft with an unknown question type can no longer be saved (the strict
    // save check refuses it), but one stored before that rule must still load
    // and show as a check error. Save a valid draft, then store the old shape.
    await saveTemplateDraft({ templateId: ids.a, schema: formSchema("Oven cleaned inside"), actorId: actor });
    await m.client.formTemplateVersion.updateMany({
      where: { templateId: ids.a, kind: "DRAFT" },
      data: { schema: formSchema("Oven cleaned inside", [{ id: "mystery", type: "hologram", label: "Mystery" }]) as object },
    });
    const query = (sort: "name" | "checks", dir: "asc" | "desc", page = 1) => ({ page, pageSize: 2, sort, dir, skip: (page - 1) * 2, take: 2 });
    const filters = { scope: "active" as const, group: "", tag: "", status: "any" as const, usedBy: "any" as const, problems: false, q: tag };
    const first = await listFormLibrary({ query: query("name", "asc"), filters });
    expect(first.total).toBe(3);
    expect(first.rows.map((r) => r.id)).toEqual([ids.a, ids.b]);
    expect((await listFormLibrary({ query: query("name", "asc", 2), filters })).rows.map((r) => r.id)).toEqual([ids.c]);
    const byChecks = await listFormLibrary({ query: query("checks", "desc"), filters });
    expect(byChecks.rows[0]).toMatchObject({ id: ids.a, status: "live-draft", checks: { status: "errors" } });
    const questionSearch = await listFormLibrary({ query: query("name", "asc"), filters: { ...filters, q: "gutters clear" } });
    expect(questionSearch.rows.map((r) => r.id)).toContain(ids.b);
    const problems = await listFormLibrary({ query: query("name", "asc"), filters: { ...filters, problems: true } });
    expect(problems.rows.map((r) => r.id)).toEqual([ids.a]);
    expect(first.rows[0]).toMatchObject({ avgMinutes: null, completionPct: null });
  });
});
