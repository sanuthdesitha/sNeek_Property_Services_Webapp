import type { Metadata } from "next";
import { getAppSettings } from "@/lib/settings";
import { FaqPage } from "@/components/public/faq-page";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";

export const metadata: Metadata = {
  title: "FAQ | sNeek Pro Services",
  description: "Frequently asked questions about booking, pricing, services, and trust — everything you need to know before your first clean.",
};

export default async function FaqRoute() {
  const settings = await getAppSettings();
  requireWebsitePageEnabled(settings.websiteContent, "faq");

  const faqItems = settings.websiteContent.faq?.items ?? [];
  const faqJsonLd = faqItems.length > 0
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqItems.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      }
    : null;

  return (
    <>
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}
      <FaqPage content={settings.websiteContent} />
    </>
  );
}
