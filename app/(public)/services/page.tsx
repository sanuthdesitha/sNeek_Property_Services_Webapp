import { getAppSettings } from "@/lib/settings";
import { ServicesPage } from "@/components/public/services-page";

export default async function ServicesPageRoute() {
  const settings = await getAppSettings();
  return <ServicesPage content={settings.websiteContent.services} />;
}
