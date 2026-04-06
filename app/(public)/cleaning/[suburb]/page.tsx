import Link from "next/link";
import { notFound } from "next/navigation";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { getSydneySuburbBySlug, SYDNEY_SUBURBS } from "@/lib/public-site/suburbs";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export async function generateStaticParams() {
  return SYDNEY_SUBURBS.map((item) => ({ suburb: item.slug }));
}

export default function PublicSuburbLandingPage({ params }: { params: { suburb: string } }) {
  const suburb = getSydneySuburbBySlug(params.suburb);
  if (!suburb) notFound();

  return (
    <div>
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="max-w-3xl space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Sydney service area</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">Cleaning services in {suburb.name}</h1>
          <p className="text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">{suburb.intro}</p>
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span className="rounded-full border bg-white/80 px-4 py-2">{suburb.statsLabel}</span>
            <span className="rounded-full border bg-white/80 px-4 py-2">Photo-backed reporting available</span>
            <span className="rounded-full border bg-white/80 px-4 py-2">Airbnb turnovers supported</span>
          </div>
        </div>
      </section>
      <section className={`${PUBLIC_PAGE_CONTAINER} pb-16`}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {MARKETED_SERVICES.slice(0, 9).map((service) => (
            <Card key={service.slug} className="rounded-[1.6rem] border-white/70 bg-white/80">
              <CardContent className="space-y-3 p-5">
                <p className="text-lg font-semibold">{service.label}</p>
                <p className="text-sm text-primary">{service.tagline}</p>
                <p className="text-sm leading-6 text-muted-foreground">{service.summary}</p>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href={`/services/${service.slug}`}>View service</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

