import { Card, CardContent } from "@/components/ui/card";
import { getAppSettings } from "@/lib/settings";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";

export default async function PrivacyPage() {
  const settings = await getAppSettings();
  requireWebsitePageEnabled(settings.websiteContent, "privacy");
  const content = settings.websiteContent.privacy;

  return (
    <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
      <div className="public-page-frame">
        <div className="max-w-4xl space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Privacy policy</p>
          <h1 className="text-4xl font-semibold">{content.title}</h1>
          <p className="text-base leading-8 text-muted-foreground">{content.intro}</p>
        </div>

        <div className="mt-10 grid gap-5">
          {content.sections.map((section) => (
            <Card key={section.title} className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)]">
              <CardContent className="space-y-4 p-6">
                <h2 className="text-2xl font-semibold">{section.title}</h2>
                <p className="text-sm leading-7 text-muted-foreground">{section.body}</p>
                <ul className="space-y-3 text-sm leading-7 text-muted-foreground">
                  {section.bullets.map((point) => (
                    <li key={point} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

