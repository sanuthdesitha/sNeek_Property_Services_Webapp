import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicHiringPage } from "@/components/workforce/public-hiring-page";
import { getPublicHiringPosition } from "@/lib/workforce/service";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";

function summarize(value: string | null | undefined, max = 180) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const position = await getPublicHiringPosition(params.slug);
  if (!position || !position.isPublished) {
    return { title: "Position not found" };
  }
  const settings = await getAppSettings().catch(() => null);
  const company = settings?.companyName?.trim() || "sNeek Property Services";
  const logo = settings?.logoUrl?.trim() || "";
  const title = `${position.title} | Careers at ${company}`;
  const description =
    summarize(position.description) ||
    `Apply for ${position.title}${position.location ? ` in ${position.location}` : ""} at ${company}.`;
  const url = resolveAppUrl(`/apply/${position.slug}`);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      siteName: company,
      images: logo ? [{ url: logo }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: logo ? [logo] : undefined,
    },
  };
}

export default async function ApplyPage({ params }: { params: { slug: string } }) {
  const position = await getPublicHiringPosition(params.slug);
  if (!position || !position.isPublished) notFound();
  return <PublicHiringPage position={position as any} />;
}
