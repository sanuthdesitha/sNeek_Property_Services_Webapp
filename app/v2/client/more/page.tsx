import { requireClientPortalPage } from "@/lib/auth/client-portal";
import { clientNavModules } from "@/lib/client/portal-modules";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { moreSectionsFor } from "@/components/v2/client/portal/portal-nav";
import { ClientMoreMenu } from "@/components/v2/client/portal/more-menu";
import { ClientMoreAccount } from "@/components/v2/client/portal/more-account";

export const metadata = { title: "More · Estate client" };
export const dynamic = "force-dynamic";

/**
 * The More tab (approved client board, 2026-11). This URL redirected to Home
 * while the portal had no More menu; it is the menu again, so old bookmarks land
 * on the grouped list of every destination that is not a tab.
 *
 * Filtering happens here on the server, from the same actor, grants and merged
 * per-client visibility the destination pages check. Each page keeps its own
 * guard whatever the menu shows.
 */
export default async function V2ClientMorePage() {
  const portal = await requireClientPortalPage();
  const sections = moreSectionsFor({
    actor: portal.actor,
    permissions: portal.permissions,
    modules: clientNavModules(portal.visibility),
  });

  return (
    <div className="space-y-6">
      <EPageHeader title="More" description="Everything else in your portal: cleans, homes, support, billing and your account." />
      <ClientMoreMenu sections={sections} />
      <ClientMoreAccount />
    </div>
  );
}
