import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { CleanerQaFeedbackCard } from "@/components/v2/cleaner/qa-feedback-card";

export const metadata = { title: "QA feedback · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * Full-page view of the cleaner's QA feedback — the same self-fetching card
 * that lives on the cleaner home, linked from the More hub.
 */
export default async function V2CleanerQualityPage() {
  await requireRole([Role.CLEANER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Quality"
        title="QA feedback"
        description="Your recent inspection outcomes — every issue, photo and score, in full."
      />
      <CleanerQaFeedbackCard />
    </div>
  );
}
