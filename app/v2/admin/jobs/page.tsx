import Link from "next/link";
import { Plus } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
// Estate-native jobs workspace (components/v2/admin/jobs) — same /api/jobs
// data plane as v1 (filters, sort, pagination, bulk ops, CSV export) with a
// fully re-imagined Estate presentation. No v1 component imports.
import { JobsWorkspace } from "@/components/v2/admin/jobs/jobs-workspace";

export const metadata = { title: "Jobs · Estate admin" };
export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  // Same gate as the v1 admin layout (v2 layouts are client-side and do no auth).
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Jobs"
        description="Every engagement across the portfolio — scheduled, in motion, and settled."
        actions={
          <EButton variant="gold" asChild>
            <Link href="/admin/jobs/new">
              <Plus className="h-4 w-4" />
              New / Bulk
            </Link>
          </EButton>
        }
      />
      <JobsWorkspace />
    </div>
  );
}
