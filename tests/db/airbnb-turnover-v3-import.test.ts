// @vitest-environment node
/**
 * "Airbnb turnover v3" through the real Forms library import on a disposable
 * PostgreSQL (127.0.0.1:55439): the file imports as an inactive draft, its
 * stock counts bind to this database's items, it opens in the builder's
 * reader unchanged, re-running creates nothing, and no other form (v1/v2 or
 * any published version) and no job's form resolution changes.
 * Run with SNEEK_TEST_DATABASE_URL pointing at a migrated disposable database.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }),
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", propertyFormTemplateOverrides: {} }) }));

import { importFormTemplates } from "@/lib/forms/template-transfer-server";
import { seedFormFileAsDrafts } from "@/lib/forms/form-file-seed";
import { readTemplateDraft } from "@/lib/forms/template-drafts";
import { toEditableSchema } from "@/lib/forms/editable-schema";
import { validateFormSchemaForSave } from "@/lib/forms/template-schema";
import { checkTemplateSchema } from "@/lib/forms/template-checks";
import { resolveEffectiveJobForm } from "@/lib/forms/resolve-effective-job-form";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `v3-${randomUUID().slice(0, 8)}`;
const actor = randomUUID();
const name = `${tag} Airbnb turnover v3`;
const raw = readFileSync(path.resolve(__dirname, "../../docs/forms/airbnb-turnover-v3.json"), "utf8");
const parsedFile = JSON.parse(raw) as { forms: Array<Record<string, unknown> & { schema: { sections: Array<{ id: string; fields: Array<Record<string, unknown>> }> } }> };
const text = JSON.stringify({ ...parsedFile, forms: [{ ...parsedFile.forms[0], name }] });
const skus = parsedFile.forms[0].schema.sections.flatMap((section) => section.fields).filter((field) => field.type === "stock_count").map((field) => String(field.stockItemId));
const createdItemIds: string[] = [];

type TemplateSnapshot = { id: string; name: string; isActive: boolean; version: number; publishedAt: Date | null; archivedAt: Date | null; updatedAt: Date };

async function otherTemplates(): Promise<TemplateSnapshot[]> {
  return m.client.formTemplate.findMany({
    where: { NOT: { name: { startsWith: tag } } },
    orderBy: { id: "asc" },
    select: { id: true, name: true, isActive: true, version: true, publishedAt: true, archivedAt: true, updatedAt: true },
  });
}

describe.skipIf(!url)("Airbnb turnover v3 import on PostgreSQL", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.create({ data: { id: actor, email: `${actor}@example.invalid`, role: "ADMIN" } });
    for (const sku of skus) {
      const existing = await m.client.inventoryItem.findUnique({ where: { sku } });
      if (existing?.isActive) continue;
      if (existing) throw Error(`Fixture item ${sku} exists but is inactive`);
      const created = await m.client.inventoryItem.create({ data: { sku, name: `${tag} ${sku}`, category: "Test", unit: "unit" } });
      createdItemIds.push(created.id);
    }
  });

  afterAll(async () => {
    if (!m.client) return;
    await m.client.formTemplate.deleteMany({ where: { name: { startsWith: tag } } });
    await m.client.auditLog.deleteMany({ where: { userId: actor } });
    await m.client.user.deleteMany({ where: { id: actor } });
    if (createdItemIds.length) await m.client.inventoryItem.deleteMany({ where: { id: { in: createdItemIds } } });
    await m.client.$disconnect();
  });

  it("dry runs through the library import without creating anything", async () => {
    const outcome = await importFormTemplates({ text, dryRun: true, actorId: actor });
    expect(outcome).toMatchObject({ dryRun: true, created: 0, refused: 0 });
    expect(outcome.forms[0].checks.errors).toBe(0);
    const seeded = await seedFormFileAsDrafts({ text, actorId: actor, dryRun: true });
    expect(seeded.forms[0]).toMatchObject({ status: "would-create", missing: [] });
    expect(seeded.forms[0].bound).toHaveLength(skus.length);
    expect(await m.client.formTemplate.count({ where: { name: { startsWith: tag } } })).toBe(0);
  });

  it("creates one inactive draft, opens it unchanged, and changes no other form", async () => {
    const before = await otherTemplates();
    const result = await seedFormFileAsDrafts({ text, actorId: actor, dryRun: false });
    expect(result.forms[0].status).toBe("created");
    const id = result.forms[0].createdId!;
    const row = await m.client.formTemplate.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ name, kind: "CUSTOM", serviceType: "AIRBNB_TURNOVER", isActive: false, publishedAt: null, archivedAt: null, isJobScoped: false });
    expect(row.tags).toEqual(["v3", "Airbnb", "Needs review"]);
    expect(await m.client.formTemplateVersion.count({ where: { templateId: id } })).toBe(0);
    expect(await readTemplateDraft(id)).toBeNull();
    expect(await m.client.auditLog.count({ where: { userId: actor, action: "FORM_TEMPLATE_IMPORTED", entityId: id } })).toBe(1);

    // Stock counts now name real items of this database.
    const stored = row.schema as { sections: Array<{ id: string; fields: Array<{ type: string; stockItemId?: string; stockItemName?: string }> }> };
    const counts = stored.sections.flatMap((section) => section.fields).filter((field) => field.type === "stock_count");
    const items = await m.client.inventoryItem.findMany({ where: { sku: { in: skus } }, select: { id: true, name: true } });
    expect(counts.map((field) => field.stockItemId).sort()).toEqual(items.map((item) => item.id).sort());
    expect(counts.every((field) => !String(field.stockItemName).includes("pick item"))).toBe(true);

    // The builder's reader opens it as stored: no injected or lost sections.
    expect(validateFormSchemaForSave(row.schema)).toEqual({ ok: true, issues: [] });
    expect(checkTemplateSchema(row.schema).errors).toBe(0);
    const editable = toEditableSchema(row.schema);
    expect(editable.standardSections).toBe(false);
    expect(editable.sections.map((section) => section.id)).toEqual(stored.sections.map((section) => section.id));

    expect(await otherTemplates()).toEqual(before);
  });

  it("is idempotent and never becomes the form a job resolves to", async () => {
    const again = await seedFormFileAsDrafts({ text, actorId: actor, dryRun: false });
    expect(again.forms[0].status).toBe("skipped-existing");
    expect(await m.client.formTemplate.count({ where: { name: { startsWith: tag } } })).toBe(1);
    const draft = await m.client.formTemplate.findFirstOrThrow({ where: { name }, select: { id: true } });
    const job = { jobType: "AIRBNB_TURNOVER" as const, propertyId: `${tag}-property`, formTemplateId: null, isRework: false, internalNotes: null, property: { name: "Fixture", bedrooms: 2, bathrooms: 1 } };
    const resolved = await resolveEffectiveJobForm(job, { propertyFormTemplateOverrides: {} });
    expect(resolved.persistedTemplateId).not.toBe(draft.id);
  });
});
