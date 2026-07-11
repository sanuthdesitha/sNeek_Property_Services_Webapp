import { getAppSettings } from "@/lib/settings";
import { ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";

export const metadata = { title: "Terms & Conditions · sNeek Property Services" };

export default async function V2TermsPage() {
  const settings = await getAppSettings().catch(() => null);
  const content = settings?.websiteContent?.terms ?? {
    title: "Terms & Conditions",
    intro: "Please read these terms carefully before using our services.",
    publicLiabilityLabel: "Public Liability",
    publicLiabilityBody: "sNeek Property Services holds $5M public liability insurance on all engagements.",
    sections: [],
  };

  return (
    <section className="mx-auto max-w-4xl px-6 py-20">
      <div className="max-w-4xl space-y-4 e-rise">
        <EEyebrow>Terms and conditions</EEyebrow>
        <h1 className="e-display-xl">{content.title}</h1>
        <p className="text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{content.intro}</p>
      </div>

      {/* Public liability highlight */}
      <div className="mt-8 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-primary-soft))] bg-[hsl(var(--e-primary-soft)/0.4)] p-6">
        <EEyebrow className="mb-2">{content.publicLiabilityLabel}</EEyebrow>
        <p className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-foreground)/0.85)]">{content.publicLiabilityBody}</p>
      </div>

      <div className="mt-10 grid gap-5">
        {(content.sections ?? []).map((section: { title: string; body: string; bullets: string[] }) => (
          <ECard key={section.title}>
            <ECardBody className="space-y-4 pt-6">
              <h2 className="e-display-sm">{section.title}</h2>
              <p className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{section.body}</p>
              {(section.bullets ?? []).length > 0 && (
                <ul className="space-y-3 text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
                  {section.bullets.map((point: string) => (
                    <li key={point} className="flex gap-3">
                      <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--e-accent-portal))]" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              )}
            </ECardBody>
          </ECard>
        ))}
      </div>
    </section>
  );
}
