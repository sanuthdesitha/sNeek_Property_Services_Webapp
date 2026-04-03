import { getAppSettings } from "@/lib/settings";
import { ContactPage } from "@/components/public/contact-page";

export default async function ContactPageRoute() {
  const settings = await getAppSettings();
  return <ContactPage content={settings.websiteContent.contact} />;
}
