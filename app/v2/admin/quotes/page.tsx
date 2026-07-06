import Link from "next/link";
import { Plus } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
// Estate-native pipeline (leads + quotes) — same /api/admin endpoints as v1,
// brand-new Estate UI. The quote builder & detail are now native Estate too.
import { QuotesPipeline } from "@/components/v2/admin/quotes/quotes-pipeline";

export const metadata = { title: "Quotes · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminQuotesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Growth"
        title="Quotes"
        description="Every enquiry from first contact to signed quote."
        actions={
          <EButton asChild variant="gold" size="sm">
            <Link href="/v2/admin/quotes/new">
              <Plus className="h-3.5 w-3.5" /> New quote
            </Link>
          </EButton>
        }
      />
      <QuotesPipeline />
    </div>
  );
}
