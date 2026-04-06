import { getAppSettings } from "@/lib/settings";
import { AirbnbHostingPage } from "@/components/public/airbnb-hosting-page";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";

export default async function AirbnbHostingPageRoute() {
  const settings = await getAppSettings();
  requireWebsitePageEnabled(settings.websiteContent, "airbnbHosting");
  return <AirbnbHostingPage content={settings.websiteContent.airbnb} />;
}
