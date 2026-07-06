import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { listClientPropertiesForUser } from "@/lib/client/portal-data";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ClientQuoteRequest } from "@/components/v2/client/quote-request";

export const metadata = { title: "Request a quote · Estate client" };
export const dynamic = "force-dynamic";

export default async function V2ClientQuoteRoute() {
  await ensureClientModuleAccess("quoteRequests");
  const session = await requireRole([Role.CLIENT]);

  const properties = await listClientPropertiesForUser(session.user.id).catch(() => []);
  const options = (properties ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    suburb: p.suburb ?? null,
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Request a quote"
        description="Tell us about the work and we'll prepare a priced proposal for your review."
      />
      <ClientQuoteRequest properties={options} />
    </div>
  );
}
