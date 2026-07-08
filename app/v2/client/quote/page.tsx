import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateQuoteWizard } from "@/components/v2/client/quote-wizard";

export const metadata = { title: "Request a quote · Estate client" };
export const dynamic = "force-dynamic";

export default async function V2ClientQuoteRoute() {
  await ensureClientModuleAccess("quoteRequests");
  const session = await requireRole([Role.CLIENT]);

  const user = await db.user
    .findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, phone: true },
    })
    .catch(() => null);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Request a quote"
        description="Quote the service properly before you send the request — start with the service family, then refine the details so the estimate reflects the actual property, access, and condition."
      />
      <EstateQuoteWizard
        defaultName={user?.name ?? session.user.name ?? null}
        defaultEmail={user?.email ?? session.user.email ?? null}
        defaultPhone={user?.phone ?? null}
      />
    </div>
  );
}
