import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { InvoicesPanel } from "@/components/v2/cleaner/invoices-panel";

export const metadata = { title: "Invoices · Estate cleaner" };
export const dynamic = "force-dynamic";

// Fully native Estate cleaner invoice tool. All data + mutations flow through the
// panel's client fetches to the same cleaner invoice endpoints the live workspace
// uses (/api/cleaner/invoice/{preview,download,send,submissions}). No new API.
const PRESETS = ["thisMonth", "lastMonth", "last2Weeks"] as const;
type Preset = (typeof PRESETS)[number];

export default async function CleanerInvoicesPage({
  searchParams,
}: {
  searchParams?: { preset?: string };
}) {
  await requireRole([Role.CLEANER]);

  // An unrecognised preset degrades to "no preset" rather than erroring — the
  // page is still perfectly usable with the payee choosing their own dates.
  const raw = searchParams?.preset;
  const preset = PRESETS.includes(raw as Preset) ? (raw as Preset) : undefined;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Earnings"
        title="Invoices"
        description="Choose a period, adjust hours or comments, then download or email your invoice."
      />
      <InvoicesPanel initialPreset={preset} />
    </div>
  );
}
