import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import {
  listStaffDirectory,
  listStaffDocumentsForAdmin,
  listStaffDocumentRequestsForAdmin,
} from "@/lib/workforce/service";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { WorkforceSubnav } from "@/components/v2/admin/workforce/workforce-subnav";
import {
  ComplianceBoard,
  type ComplianceDoc,
  type ComplianceRequest,
  type ComplianceStaff,
} from "@/components/v2/admin/workforce/compliance-board";

export const metadata = { title: "Compliance · Estate workforce" };
export const dynamic = "force-dynamic";

export default async function WorkforceCompliancePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const [documents, requests, directory] = await Promise.all([
    listStaffDocumentsForAdmin().catch(() => []),
    listStaffDocumentRequestsForAdmin().catch(() => []),
    listStaffDirectory().catch(() => []),
  ]);

  const docs: ComplianceDoc[] = documents.map((d) => ({
    id: d.id,
    title: d.title,
    category: d.category,
    status: d.status,
    fileName: d.fileName,
    url: d.url,
    notes: d.notes ?? null,
    expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    requiresSignature: d.requiresSignature,
    user: { id: d.user.id, name: d.user.name ?? "Unknown", role: d.user.role, image: d.user.image },
    verifiedByName: d.verifiedBy?.name ?? null,
  }));

  const reqs: ComplianceRequest[] = requests
    .filter((r) => r.status === "REQUESTED")
    .map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      notes: r.notes ?? null,
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      user: { id: r.user.id, name: r.user.name ?? "Unknown" },
      requestedByName: r.requestedBy?.name ?? null,
    }));

  const staff: ComplianceStaff[] = directory.map((u) => ({
    id: u.id,
    name: u.name ?? u.email,
    role: u.role,
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Compliance"
        description="Track document expiry, review uploads and chase what's missing — for the whole team."
      />
      <WorkforceSubnav active="compliance" />
      <ComplianceBoard documents={docs} requests={reqs} staff={staff} />
    </div>
  );
}
