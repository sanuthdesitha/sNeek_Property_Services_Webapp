import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { PracticeBoundary } from "@/components/v2/tutorials/practice-boundary";
import { PracticeJob } from "@/components/v2/cleaner/practice/practice-job";

export const metadata = { title: "Practice job · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * The practice job (board "Phone tours"): the real job stages with a sample
 * job. Nothing is read from or written to the database; nothing counts towards
 * pay. The h1 is the job header's own, as on a real job.
 */
export default async function CleanerPracticeJobPage() {
  await requireRole([Role.CLEANER]);
  return (
    <PracticeBoundary tourKey="cleaner.job.practice" fixtureSet="cleanerJob">
      <PracticeJob />
    </PracticeBoundary>
  );
}
