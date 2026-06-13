import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { FormBuilder } from "@/components/forms/form-builder";
import type { FormSchema } from "@/lib/forms/types";

export const dynamic = "force-dynamic";

export default async function FormEditPage({
  params,
}: {
  params: { id: string };
}) {
  const template = await db.formTemplate.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      kind: true,
      schema: true,
      isActive: true,
      archivedAt: true,
      version: true,
    },
  });

  if (!template) notFound();

  // Coerce JSON column → FormSchema. Older templates may store the legacy
  // `{ sections: [{ label, fields }] }` shape; normalize to V1 here so the
  // builder always sees `title`.
  const rawSchema = (template.schema ?? {}) as any;
  const sections = Array.isArray(rawSchema?.sections)
    ? rawSchema.sections.map((s: any, idx: number) => ({
        id: typeof s?.id === "string" ? s.id : `s-${idx}`,
        title:
          typeof s?.title === "string"
            ? s.title
            : typeof s?.label === "string"
              ? s.label
              : `Section ${idx + 1}`,
        description: typeof s?.description === "string" ? s.description : undefined,
        collapsible: typeof s?.collapsible === "boolean" ? s.collapsible : undefined,
        fields: Array.isArray(s?.fields)
          ? s.fields.map((f: any, fIdx: number) => ({
              // Preserve all advanced config (min/max/step/unit/references/etc.)
              // by spreading first, then normalizing the legacy/required bits.
              ...(f && typeof f === "object" ? f : {}),
              id: typeof f?.id === "string" ? f.id : `f-${idx}-${fIdx}`,
              type: typeof f?.type === "string" ? f.type : "text",
              label: typeof f?.label === "string" ? f.label : "Field",
              helpText: typeof f?.helpText === "string" ? f.helpText : undefined,
              required: typeof f?.required === "boolean" ? f.required : undefined,
              options: Array.isArray(f?.options) ? f.options : undefined,
              minPhotos: typeof f?.minPhotos === "number" ? f.minPhotos : undefined,
              conditional:
                f?.conditional && typeof f.conditional === "object"
                  ? f.conditional
                  : undefined,
              scoring:
                f?.scoring && typeof f.scoring === "object" ? f.scoring : undefined,
            }))
          : [],
      }))
    : [];

  // Preserve the optional appearance theme (schema.theme) so the builder can
  // edit + re-save it. Unknown keys are dropped by the normalizer above, so
  // theme must be carried through explicitly.
  const theme =
    rawSchema?.theme && typeof rawSchema.theme === "object" ? rawSchema.theme : undefined;

  const initialSchema: FormSchema = { sections, ...(theme ? { theme } : {}) };

  return (
    <FormBuilder
      templateId={template.id}
      initialName={template.name}
      initialKind={template.kind}
      initialVersion={template.version}
      initialSchema={initialSchema}
      initialIsActive={template.isActive}
      initialArchived={Boolean(template.archivedAt)}
    />
  );
}
