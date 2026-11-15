import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { NewJobForm } from "@/components/v2/admin/jobs/new-job-form";
import { PracticeBoundary } from "@/components/v2/tutorials/practice-boundary";
import { PRACTICE_PROPERTY } from "@/lib/tutorials/practice-samples";

export const metadata = { title: "Practice job · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * "Create a job" practice (board "Admin tours", C): the real New job form,
 * offered only the practice property, client and cleaners. Its reads are
 * answered in the browser and every write is stopped by the practice guard, so
 * nothing is saved and no offer is sent.
 */
export default async function PracticeNewJobPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Operations · Practice" title="Create jobs" description="Practice: the real form with a sample property. Nothing is saved and no offer is sent." />
      <PracticeBoundary tourKey="admin.jobs.create" fixtureSet="adminNewJob">
        <NewJobForm initialPropertyId={PRACTICE_PROPERTY.id} />
      </PracticeBoundary>
    </div>
  );
}
