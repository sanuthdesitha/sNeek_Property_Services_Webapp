import { requireClientPortalPage } from "@/lib/auth/client-portal";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ClientLostFound } from "@/components/v2/client/lost-found/client-lost-found";

export const metadata = { title: "Lost and found · Estate client" };
export const dynamic = "force-dynamic";

/**
 * Lost and found for the client (2026-11-20): items found at the client's own
 * properties and the guests' return requests. The page guard and the API both
 * read the client and property scope from the database.
 */
export default async function ClientLostFoundPage() {
  await requireClientPortalPage({ permission: "properties" });
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your homes"
        title="Lost and found"
        description="Items our team found at your properties, and what each guest asked for to get theirs back."
      />
      <ClientLostFound />
    </div>
  );
}
