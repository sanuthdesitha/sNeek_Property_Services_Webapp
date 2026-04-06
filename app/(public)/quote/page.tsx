import { RequestQuotePage } from "@/components/quote/request-quote-page";
import { getAppSettings } from "@/lib/settings";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";

export default async function PublicQuotePage() {
  const settings = await getAppSettings();
  requireWebsitePageEnabled(settings.websiteContent, "quote");
  return <RequestQuotePage mode="public" />;
}
