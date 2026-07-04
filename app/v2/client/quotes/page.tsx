import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ClientQuotesPage } from "@/components/client/client-quotes-page";

export const metadata = { title: "Quotes · Estate client" };
export const dynamic = "force-dynamic";

export default async function V2ClientQuotesRoute() {
  await requireRole([Role.CLIENT]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Quotes"
        description="Your requested estimates and their status — review, accept, or decline."
      />
      <ClientQuotesPage />
    </div>
  );
}
