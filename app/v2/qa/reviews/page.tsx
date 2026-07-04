import { EBadge, ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";
import { ChevronRight } from "lucide-react";

export const metadata = { title: "Reviews · Estate QA" };

const REVIEWS = [
  { property: "12 Marine Parade", cleaner: "Ana R.", score: "—", tone: "warning" as const, status: "Pending" },
  { property: "5/44 Beach St", cleaner: "Marco P.", score: "96%", tone: "success" as const, status: "Passed" },
  { property: "88 Ocean View Rd", cleaner: "Lena K.", score: "88%", tone: "info" as const, status: "Passed" },
  { property: "9 Palm Ave", cleaner: "Sam T.", score: "72%", tone: "danger" as const, status: "Rework" },
];

export default function QaReviewsPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="History" title="Reviews" description="Completed and pending inspections." />
      <div className="space-y-3">
        {REVIEWS.map((r, i) => (
          <ECard key={i}>
            <ECardBody className="flex items-center gap-3 pt-6">
              <div className="min-w-0 flex-1">
                <p className="text-[0.875rem] font-medium">{r.property}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{r.cleaner}</p>
              </div>
              <span className="e-numeral text-[0.9375rem]">{r.score}</span>
              <EBadge tone={r.tone} soft>{r.status}</EBadge>
              <ChevronRight className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
            </ECardBody>
          </ECard>
        ))}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
