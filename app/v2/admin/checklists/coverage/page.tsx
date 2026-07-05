import { Role } from "@prisma/client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateChecklistCoverage } from "@/components/v2/admin/checklists/checklist-coverage";

export const metadata = { title: "Checklist coverage · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateChecklistCoveragePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <Link
        href="/v2/admin/checklists"
        className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] transition-colors hover:text-[hsl(var(--e-foreground))]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to library
      </Link>
      <EPageHeader
        eyebrow="Rollout"
        title="Checklist coverage"
        description="Bulk-generate default draft checklists across your properties, track set-up status, and send clients an amenities survey link."
      />
      <EstateChecklistCoverage />
    </div>
  );
}
