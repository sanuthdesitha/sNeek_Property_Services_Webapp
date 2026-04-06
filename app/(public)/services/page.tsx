import { getAppSettings } from "@/lib/settings";
import { ServicesPage } from "@/components/public/services-page";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";

export default async function ServicesPageRoute() {
  const settings = await getAppSettings();
  requireWebsitePageEnabled(settings.websiteContent, "services");
  return <ServicesPage content={settings.websiteContent.services} />;
}
