import { ensureClientModuleAccess } from "@/lib/portal-access";
import { RequestQuotePage } from "@/components/quote/request-quote-page";

export default async function ClientQuotePage() {
  await ensureClientModuleAccess("quoteRequests");
  return <RequestQuotePage mode="client" />;
}
