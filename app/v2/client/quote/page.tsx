import { ensureClientModuleAccess } from "@/lib/portal-access";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { RequestQuotePage } from "@/components/quote/request-quote-page";

export const metadata = { title: "Request a quote · Estate client" };
export const dynamic = "force-dynamic";

export default async function V2ClientQuoteRoute() {
  await ensureClientModuleAccess("quoteRequests");

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Request a quote"
        description="Tell us about the work and we'll prepare an estimate for your review."
      />
      <RequestQuotePage mode="client" />
    </div>
  );
}
