import Link from "next/link";
import { ArrowRight, Briefcase, MapPin, Share2 } from "lucide-react";
import { db } from "@/lib/db";
import { EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";

export const metadata = { title: "Careers · sNeek Property Services" };

const DEPT_COLORS: Record<string, string> = {
  operations: "border-[hsl(var(--e-info-soft))] bg-[hsl(var(--e-info-soft))] text-[hsl(var(--e-info))]",
  cleaning: "border-[hsl(var(--e-primary-soft))] bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]",
  laundry: "border-[hsl(var(--e-warning-soft))] bg-[hsl(var(--e-warning-soft))] text-[hsl(var(--e-warning))]",
  admin: "border-[hsl(var(--e-gold-soft))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]",
};

function deptClass(dept: string | null) {
  return DEPT_COLORS[(dept ?? "").toLowerCase()] ?? "border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]";
}

export default async function V2CareersPage() {
  const positions = await db.hiringPosition
    .findMany({
      where: { isPublished: true },
      orderBy: { createdAt: "desc" },
    })
    .catch(() => []);

  return (
    <div className="relative overflow-hidden pb-20 pt-10 sm:pb-24 sm:pt-14">
      {/* Subtle glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top,hsl(var(--e-primary)/0.06),transparent_60%)]" />

      <section className="relative z-10 mx-auto max-w-6xl space-y-10 px-6">
        {/* Heading */}
        <div className="max-w-3xl space-y-4 e-rise">
          <EEyebrow>Careers at sNeek</EEyebrow>
          <h1 className="e-display-xl">Join the team behind the standards.</h1>
          <p className="text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
            We&apos;re building a reliable property-care team across Parramatta and Greater Sydney. If you care about presentation,
            consistency, and doing the practical details properly, this is where to start.
          </p>
        </div>

        {/* Position cards */}
        {positions.length > 0 ? (
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {positions.map((position: any) => (
              <ECard key={position.id} className="overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--e-elevation-2)]">
                <ECardBody className="flex h-full flex-col gap-5 pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <span className={`inline-flex items-center rounded-[var(--e-radius-pill)] border px-3 py-1 text-[0.6875rem] font-medium ${deptClass(position.department)}`}>
                      {position.department || "Team"}
                    </span>
                    <Briefcase className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="e-display-sm">{position.title}</h2>
                    <div className="flex flex-wrap gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      {position.location && (
                        <span className="inline-flex items-center gap-1 rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-muted))] px-3 py-1">
                          <MapPin className="h-3.5 w-3.5" />{position.location}
                        </span>
                      )}
                      {position.employmentType && (
                        <span className="rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-muted))] px-3 py-1">{position.employmentType}</span>
                      )}
                    </div>
                    <p className="line-clamp-4 text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
                      {position.description || "View the role to see full expectations, requirements, and application steps."}
                    </p>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                    <EButton asChild variant="gold">
                      <Link href={`/apply/${position.slug}`}>
                        View &amp; Apply <ArrowRight className="h-4 w-4" />
                      </Link>
                    </EButton>
                    <EButton asChild variant="outline">
                      <Link href={`/apply/${position.slug}`}>
                        <Share2 className="h-4 w-4" /> Share
                      </Link>
                    </EButton>
                  </div>
                </ECardBody>
              </ECard>
            ))}
          </div>
        ) : (
          <ECard className="border-dashed">
            <ECardBody className="space-y-3 py-12 text-center pt-6">
              <p className="text-[1.0625rem] font-semibold">No positions currently open.</p>
              <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Check back soon or contact us if you would like to register interest for future roles.</p>
            </ECardBody>
          </ECard>
        )}

        {/* Future opps */}
        <ECard className="border-[hsl(var(--e-primary-soft))] bg-[hsl(var(--e-primary-soft)/0.4)]">
          <ECardBody className="pt-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div className="space-y-2">
              <EEyebrow>Future opportunities</EEyebrow>
              <p className="text-[1.0625rem] font-semibold">Don&apos;t see the right role yet?</p>
              <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">Send us your details and we&apos;ll keep you in mind as the team grows.</p>
            </div>
            <EButton asChild variant="outline" className="mt-4 sm:mt-0 shrink-0">
              <Link href="/v2/contact">Contact us</Link>
            </EButton>
          </ECardBody>
        </ECard>
      </section>
    </div>
  );
}
