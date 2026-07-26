import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { InvoicesPanel } from "@/components/v2/cleaner/invoices-panel";

export const metadata = { title: "Invoices · Estate QA" };
export const dynamic = "force-dynamic";

// QA inspectors self-invoice exactly like cleaners — inspection pay rides the
// SAME rail (/api/cleaner/invoice/{preview,download,send,submissions}), which
// derives the payee from the session and already produces a correct
// inspections-only invoice. So this mounts the SHARED panel with inspector copy
// rather than forking a second invoice UI that would drift from the money rules.
export default async function QaInvoicesPage() {
  await requireRole([Role.QA_INSPECTOR]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Earnings"
        title="Invoices"
        description="Choose a period, review your inspections, then download or email your invoice to accounts."
      />
      <InvoicesPanel payeeKind="inspector" profileHref="/v2/qa/profile" />
    </div>
  );
}
