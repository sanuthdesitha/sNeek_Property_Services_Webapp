import { db } from "@/lib/db";
import { CareersPage } from "@/components/public/careers-page";
import { getAppSettings } from "@/lib/settings";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";

export default async function CareersPublicPage() {
  const settings = await getAppSettings();
  requireWebsitePageEnabled(settings.websiteContent, "careers");
  const positions = await db.hiringPosition.findMany({
    where: { isPublished: true },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      department: true,
      location: true,
      employmentType: true,
    },
  });

  return <CareersPage positions={positions} />;
}
