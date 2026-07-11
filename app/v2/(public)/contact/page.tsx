import { getAppSettings } from "@/lib/settings";
import { ContactPageClient } from "@/components/v2/public/contact-page-client";

export const metadata = { title: "Contact · sNeek Property Services" };

export default async function V2ContactPage() {
  const settings = await getAppSettings().catch(() => null);
  const content = settings?.websiteContent;

  return (
    <ContactPageClient
      eyebrow={content?.contact?.eyebrow ?? "Get in touch"}
      title={content?.contact?.title ?? "Let's talk about your property."}
      intro={content?.contact?.intro ?? "Whether it's a quick question or a custom quote, we're here to help."}
      formIntro={content?.contact?.formIntro ?? "Use this form for custom quotes, recurring service discussions, or anything that needs a proper review."}
      displayEmail={content?.contact?.displayEmail ?? "info@sneekproservices.com.au"}
      displayPhone={content?.contact?.displayPhone ?? "+61 451 217 210"}
      addressLine={content?.contact?.addressLine ?? "Parramatta, NSW 2150"}
      responsePromise={content?.contact?.responsePromise ?? "We typically respond within 1 business day."}
    />
  );
}
