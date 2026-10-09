import { requireJobsViewsContext } from "@/lib/jobs/views-context";
// Estate-native jobs workspace (components/v2/admin/jobs) — same /api/jobs
// data plane as v1 (filters, sort, pagination, bulk ops, CSV export) with a
// fully re-imagined Estate presentation. No v1 component imports.
import { JobsWorkspace } from "@/components/v2/admin/jobs/jobs-workspace";

export const metadata = { title: "Jobs · Estate admin" };
export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  // Same gate as the v1 admin layout (v2 layouts are client-side and do no auth).
  const identity = await requireJobsViewsContext();

  return (
    <div className="space-y-6">
      <JobsWorkspace key={identity.context} viewsContext={identity.context} viewsReadOnly={identity.readOnly} teamDefaultsEnabled showPageHeader />
    </div>
  );
}
