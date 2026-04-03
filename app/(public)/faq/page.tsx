import type { Metadata } from "next";
import { getAppSettings } from "@/lib/settings";
import { FaqPage } from "@/components/public/faq-page";

export const metadata: Metadata = {
  title: "FAQ | sNeek Pro Services",
  description: "Frequently asked questions about booking, pricing, services, and trust — everything you need to know before your first clean.",
};

export default async function FaqRoute() {
  const settings = await getAppSettings();
  return <FaqPage content={settings.websiteContent} />;
}
