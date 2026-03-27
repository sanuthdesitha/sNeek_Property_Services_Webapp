import { notFound } from "next/navigation";
import { PublicHiringPage } from "@/components/workforce/public-hiring-page";
import { getPublicHiringPosition } from "@/lib/workforce/service";

export default async function ApplyPage({ params }: { params: { slug: string } }) {
  const position = await getPublicHiringPosition(params.slug);
  if (!position || !position.isPublished) notFound();
  return <PublicHiringPage position={position} />;
}

