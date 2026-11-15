import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { TutorialsWorkspace, type TutorialsTab } from "@/components/v2/admin/settings/tutorials/tutorials-workspace";
import fingerprints from "@/lib/tutorials/fingerprints.json";
import type { FingerprintFile } from "@/lib/tutorials/fingerprint";

export const metadata = { title: "Tutorials · Estate admin" };
export const dynamic = "force-dynamic";

const TABS: readonly TutorialsTab[] = ["tours", "whats-new", "people", "switches"];

/**
 * Settings › System › Tutorials (board "Tutorials settings", 2026-11).
 * Administrators edit (an ordinary confirmation, no PIN: tours neither send
 * nor charge). Operations managers with the Settings pack view. Every route
 * re-checks on the server. Targets come from the code registry only.
 */
export default async function TutorialsSettingsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings().catch(() => null);
  const tab = TABS.find((entry) => entry === searchParams?.tab) ?? "tours";
  const notes = Object.entries(fingerprints as FingerprintFile).flatMap(([tourKey, entry]) =>
    (entry.noVisibleChange ?? []).map((note) => ({ tourKey, ...note })),
  );
  return (
    <div className="min-w-0 space-y-5">
      <EPageHeader
        eyebrow="Settings › System"
        title="Tutorials"
        description="Welcome screens, page tours, walkthroughs and What's new for every role. Words and order are edited here; the controls they point at come from the code."
        actions={<EButton asChild variant="outline" size="sm"><Link href="/v2/admin/settings?tab=audit">Back to settings</Link></EButton>}
      />
      <TutorialsWorkspace
        canEdit={session.user.role === Role.ADMIN}
        timezone={settings?.timezone ?? "Australia/Sydney"}
        tab={tab}
        noVisibleChange={notes}
      />
    </div>
  );
}
