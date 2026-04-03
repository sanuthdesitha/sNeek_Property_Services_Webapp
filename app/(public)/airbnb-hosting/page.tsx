import { getAppSettings } from "@/lib/settings";
import { AirbnbHostingPage } from "@/components/public/airbnb-hosting-page";

export default async function AirbnbHostingPageRoute() {
  const settings = await getAppSettings();
  return <AirbnbHostingPage content={settings.websiteContent.airbnb} />;
}
