import { getAppSettings } from "@/lib/settings";
import { FaqClient } from "@/components/v2/public/faq-client";

export const metadata = { title: "FAQ · sNeek Property Services" };

export default async function V2FaqPage() {
  const settings = await getAppSettings().catch(() => null);
  const content = settings?.websiteContent ?? ({
    faq: { title: "Got questions? We have answers.", intro: "Everything you need to know before booking.", items: [] },
  } as any);

  return <FaqClient content={content} />;
}
