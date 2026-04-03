import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAppSettings } from "@/lib/settings";
import { getMarketedServiceBySlug } from "@/lib/marketing/catalog";
import { ServiceDetailPage } from "@/components/public/service-detail-page";

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const service = getMarketedServiceBySlug(params.slug);
  if (!service) return {};
  return {
    title: `${service.label} | sNeek Pro Services`,
    description: service.summary,
  };
}

export default async function ServiceSlugPage({ params }: Props) {
  const service = getMarketedServiceBySlug(params.slug);
  if (!service) notFound();

  const settings = await getAppSettings();
  const pageContent = settings.websiteContent.servicePages?.[params.slug] ?? {
    heroImageUrl: "",
    heroImageAlt: "",
    whatIncluded: [],
    notIncluded: [],
    idealFor: "",
    priceGuide: "",
    faq: [],
  };

  return <ServiceDetailPage service={service} pageContent={pageContent} />;
}
