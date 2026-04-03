import { db } from "@/lib/db";
import { CareersPage } from "@/components/public/careers-page";

export default async function CareersPublicPage() {
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
