import { ComparePage } from "@/components/public/compare-page";
import { getAppSettings } from "@/lib/settings";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";

export default async function PublicComparePage() {
  const settings = await getAppSettings();
  requireWebsitePageEnabled(settings.websiteContent, "compareServices");
  return <ComparePage servicePages={settings.websiteContent.servicePages} />;
}
