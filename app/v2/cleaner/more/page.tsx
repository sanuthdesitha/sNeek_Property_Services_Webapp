import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { CleanerMoreMenu } from "@/components/v2/cleaner/portal/more-menu";
import type { CleanerNavModule } from "@/components/v2/cleaner/portal/portal-nav";

export const metadata = { title: "More · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * The More tab (approved cleaner board, 2026-11). This URL redirected to Today
 * while the portal had no More menu; it is the menu again, so old bookmarks and
 * the printed induction sheet land on the labelled list of every destination.
 *
 * Module gates are read here on the server and passed as plain booleans; each
 * destination keeps its own server guard regardless of what the menu shows.
 */
export default async function V2CleanerMorePage() {
  await requireRole([Role.CLEANER]);
  const settings = await getAppSettings().catch(() => null);
  // Unknown settings hide nothing: the destination's own guard still decides.
  const modules: Partial<Record<CleanerNavModule, boolean>> = settings
    ? {
        calendar: isCleanerModuleEnabled(settings, "calendar"),
        lostFound: isCleanerModuleEnabled(settings, "lostFound"),
      }
    : {};

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <EPageHeader title="More" description="Everything else you can open, grouped by work and by you." />
      <CleanerMoreMenu modules={modules} />
    </div>
  );
}
