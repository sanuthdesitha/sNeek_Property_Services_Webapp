import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { FormSchema } from "@/lib/forms/types";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
import { EstateFormBuilder } from "@/components/v2/admin/forms/builder/form-builder";

export const metadata = { title: "Edit form template · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateFormEditPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const template = await db.formTemplate.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      kind: true,
      serviceType: true,
      schema: true,
      isActive: true,
      archivedAt: true,
      version: true,
    },
  });

  if (!template) notFound();

  // Canonicalise through the SAME normalizer the cleaner read + submit routes
  // use, so the builder edits exactly the schema the runtime enforces: legacy
  // `label`/`upload`/`{fieldId,equals}` shapes are rewritten, and the standard
  // sections (arrival evidence / exceptions / sign-off) are visible + editable
  // instead of being invisibly injected downstream. Templates that already
  // carry `standardSections: false` keep their baked copies untouched.
  const normalized = normalizeFormSchema(template.schema);
  const rawSchema = { ...normalized } as any;
  const sections = Array.isArray(rawSchema?.sections)
    ? rawSchema.sections.map((s: any, idx: number) => ({
        ...(s && typeof s === "object" ? s : {}),
        id: typeof s?.id === "string" ? s.id : `s-${idx}`,
        title:
          typeof s?.title === "string" ? s.title : typeof s?.label === "string" ? s.label : `Section ${idx + 1}`,
        description: typeof s?.description === "string" ? s.description : undefined,
        fields: Array.isArray(s?.fields)
          ? s.fields.map((f: any, fIdx: number) => ({
              ...(f && typeof f === "object" ? f : {}),
              id: typeof f?.id === "string" ? f.id : `f-${idx}-${fIdx}`,
              type: typeof f?.type === "string" ? f.type : "text",
              label: typeof f?.label === "string" ? f.label : "Field",
            }))
          : [],
      }))
    : [];

  const theme = rawSchema?.theme && typeof rawSchema.theme === "object" ? rawSchema.theme : undefined;
  const initialSchema: FormSchema = {
    sections,
    ...(theme ? { theme } : {}),
    // Preserve the opt-out flag across a builder round-trip.
    ...(normalized.standardSections === false ? { standardSections: false as const } : {}),
  };

  return (
    <EstateFormBuilder
      templateId={template.id}
      initialName={template.name}
      initialKind={String(template.kind)}
      initialServiceType={String(template.serviceType)}
      initialVersion={template.version}
      initialSchema={initialSchema}
      initialIsActive={template.isActive}
      initialArchived={Boolean(template.archivedAt)}
    />
  );
}
