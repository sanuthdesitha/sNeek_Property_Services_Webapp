import { getAppSettings } from "@/lib/settings";
import { ContactPage } from "@/components/public/contact-page";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";

export default async function ContactPageRoute() {
  const settings = await getAppSettings();
  requireWebsitePageEnabled(settings.websiteContent, "contact");
  return <ContactPage content={settings.websiteContent.contact} />;
}
