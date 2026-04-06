import { getAppSettings } from "@/lib/settings";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";
import { WhyUsPage } from "@/components/public/why-us-page";

export default async function WhyUsPageRoute() {
  const settings = await getAppSettings();
  requireWebsitePageEnabled(settings.websiteContent, "whyUs");
  return <WhyUsPage content={settings.websiteContent} />;
}
