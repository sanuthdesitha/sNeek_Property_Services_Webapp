import "server-only";
/**
 * Everything the builder page needs on first render, read once on the server:
 * the template, its draft (the builder edits the draft when one exists), the
 * schema in editable form, which properties use the live version (the
 * library's own usage rule) and the library's 90-day "never answered" check.
 */
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { toEditableSchema } from "./editable-schema";
import { createUsageResolver } from "./library-usage";
import { loadUsageFigures } from "./library-figures";
import type { FormUsage } from "./library-types";
import { readTemplateDraft, templateEditToken } from "./template-drafts";
import type { FormSchema } from "./types";

export type BuilderUsage = {
  usage: FormUsage;
  /** Required questions of the LIVE version never answered in the usage window. */
  neverAnswered: Array<{ id: string; label: string }>;
  usageSample: number;
  /** Organisation timezone for history times. */
  timezone: string;
};

export const DEFAULT_TIMEZONE = "Australia/Sydney";

export type BuilderContext = {
  templateId: string;
  name: string;
  kind: string;
  serviceType: string;
  liveVersion: number;
  isActive: boolean;
  archived: boolean;
  hasDraft: boolean;
  draftUpdatedAt: string | null;
  editToken: string;
  schema: FormSchema;
  /** Null when the usage figures could not be read (shown as unavailable, never as zero). */
  usage: BuilderUsage | null;
};

/** The template and its draft: what the builder cannot open without. */
export async function loadBuilderContext(templateId: string): Promise<BuilderContext | null> {
  const template = await db.formTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, name: true, kind: true, serviceType: true, schema: true, isActive: true, archivedAt: true, version: true, updatedAt: true },
  });
  if (!template) return null;
  const draft = await readTemplateDraft(template.id);
  return {
    templateId: template.id,
    name: draft?.name ?? template.name,
    kind: String(template.kind),
    serviceType: String(draft?.serviceType ?? template.serviceType),
    liveVersion: template.version,
    isActive: template.isActive,
    archived: Boolean(template.archivedAt),
    hasDraft: Boolean(draft),
    draftUpdatedAt: draft ? draft.updatedAt.toISOString() : null,
    editToken: templateEditToken(template.updatedAt, draft),
    schema: toEditableSchema(draft ? draft.schema : template.schema),
    usage: await loadBuilderUsage(template.id, template.schema),
  };
}

/** "Live on N properties" and the never-answered check; null if unreadable. */
async function loadBuilderUsage(templateId: string, liveSchema: unknown): Promise<BuilderUsage | null> {
  try {
    const [settings, properties, templates, figures] = await Promise.all([
      getAppSettings(),
      db.property.findMany({ where: { isActive: true }, select: { id: true } }),
      db.formTemplate.findMany({
        select: { id: true, serviceType: true, isActive: true, version: true, publishedAt: true, updatedAt: true, createdAt: true, isJobScoped: true, archivedAt: true },
      }),
      loadUsageFigures([{ id: templateId, schema: liveSchema }], new Date()),
    ]);
    const rows = templates.map((row) => ({ ...row, serviceType: String(row.serviceType) }));
    const usageOf = createUsageResolver({
      overrides: settings.propertyFormTemplateOverrides,
      activePropertyIds: properties.map((property) => property.id),
      templates: rows,
    });
    const self = rows.find((row) => row.id === templateId);
    const figure = figures.get(templateId);
    return {
      usage: self ? usageOf(self) : { kind: "not-live" },
      neverAnswered: (figure?.neverAnswered ?? []).map((question) => ({ id: question.id, label: question.label })),
      usageSample: figure?.usageSample ?? 0,
      timezone: settings.timezone || DEFAULT_TIMEZONE,
    };
  } catch {
    return null;
  }
}
