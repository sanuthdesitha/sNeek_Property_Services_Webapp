import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { resolveBrandTokens } from "@/lib/brand/tokens";
import { getAppSettings } from "@/lib/settings";
import { getKindConfig } from "@/lib/templates/kinds";
import { safeParseTemplateDoc } from "@/lib/templates/model";
import { defaultDocForKind, getOrCreateDefinition, getOrCreateDraft } from "@/lib/templates/store";
import { TemplateEditor } from "@/components/admin/templates-v2/template-editor";

export const dynamic = "force-dynamic";

export default async function TemplateEditorPage({ params }: { params: { kind: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const kind = decodeURIComponent(params.kind);
  const config = getKindConfig(kind);
  if (!config) notFound();

  const definition = await getOrCreateDefinition(kind);
  const draft = await getOrCreateDraft(definition.id);
  // Stored drafts are zod-validated on the way out; fall back to the seed doc
  // rather than crashing the editor on a malformed row.
  const doc = safeParseTemplateDoc(draft.doc) ?? defaultDocForKind(kind);
  const brand = resolveBrandTokens(await getAppSettings());

  return (
    <TemplateEditor
      kind={kind}
      definitionId={definition.id}
      draftId={draft.id}
      initialDoc={doc}
      initialToken={draft.updatedAt.toISOString()}
      brand={brand}
    />
  );
}
