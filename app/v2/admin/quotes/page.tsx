import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
// Estate-native pipeline (leads + quotes) — same /api/admin endpoints as v1,
// brand-new Estate UI. The deep quote builder stays classic for now.
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
          <Link
            href="/admin/quotes/new"
            className="text-[0.8125rem] font-[550] text-[hsl(var(--e-gold-ink))] underline-offset-4 hover:underline"
          >
            New quote (classic builder) →
          </Link>
        }
      />
      <QuotesPipeline />
    </div>
  );
}
