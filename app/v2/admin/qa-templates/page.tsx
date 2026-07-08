import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { QaTemplatesManager } from "@/components/v2/admin/qa/qa-templates-manager";

export const metadata = { title: "QA templates · Estate admin" };
export const dynamic = "force-dynamic";

// Estate-native QA form template management. Same endpoints as v1
// (/api/admin/qa/templates GET/POST + /api/admin/qa/templates/[id] PATCH):
// list, create, edit metadata + schema, activate/deactivate, reset to default.
export default async function AdminQaTemplatesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Quality"
        title="QA templates"
        description="Inspection scoring forms per job type, with optional per-property overrides."
      />

      <QaTemplatesManager />
    </div>
  );
}
