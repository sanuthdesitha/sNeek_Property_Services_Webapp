import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadBuilderContext } from "@/lib/forms/builder-context";
import { EstateFormBuilder } from "@/components/v2/admin/forms/builder/form-builder";

export const metadata = { title: "Edit form template · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateFormEditPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN]);

  // The builder edits the template's DRAFT version when one exists (saving
  // writes the draft; publishing makes it live). The schema is canonicalised
  // by the SAME normalizer the cleaner read and submit routes use
  // (lib/forms/editable-schema.ts), so the builder edits exactly what the
  // runtime enforces.
  const context = await loadBuilderContext(params.id);
  if (!context) notFound();

  return (
    <EstateFormBuilder
      templateId={context.templateId}
      initialName={context.name}
      initialKind={context.kind}
      initialServiceType={context.serviceType}
      initialVersion={context.liveVersion}
      initialSchema={context.schema}
      initialIsActive={context.isActive}
      initialArchived={context.archived}
      // The version this render is of. The builder sends it back on save so
      // the server can refuse a write from an editor that has gone stale.
      // With a draft, the draft's own updatedAt is the token.
      initialUpdatedAt={context.editToken}
      initialHasDraft={context.hasDraft}
      initialDraftSavedAt={context.draftUpdatedAt}
      usage={context.usage}
    />
  );
}
