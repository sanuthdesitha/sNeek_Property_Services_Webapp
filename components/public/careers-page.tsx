"use client";

import Link from "next/link";
import { ArrowRight, MapPin, Briefcase } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";
import { cn } from "@/lib/utils";

type CareerPosition = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  department: string | null;
  location: string | null;
  employmentType: string | null;
};

const DEPARTMENT_BADGE_CLASSES: Record<string, string> = {
  operations: "border-teal-200 bg-teal-50 text-teal-700",
  cleaning: "border-sky-200 bg-sky-50 text-sky-700",
  laundry: "border-amber-200 bg-amber-50 text-amber-800",
  admin: "border-violet-200 bg-violet-50 text-violet-700",
};

function departmentClassName(department: string | null) {
  const key = (department || "operations").trim().toLowerCase();
  return DEPARTMENT_BADGE_CLASSES[key] ?? "border-primary/20 bg-primary/5 text-primary";
}

export function CareersPage({ positions }: { positions: CareerPosition[] }) {
  return (
    <div className="relative overflow-hidden pb-20 pt-10 sm:pb-24 sm:pt-14">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,rgba(36,159,171,0.12),transparent_58%)]" />

      <section className={cn(PUBLIC_PAGE_CONTAINER, "relative z-10 space-y-8") }>
        <div className="max-w-3xl space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Careers at sNeek</p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">Join the team behind the standards.</h1>
          <p className="text-lg leading-8 text-muted-foreground">
            We are building a reliable property-care team across Parramatta and Greater Sydney. If you care about presentation,
            consistency, and doing the practical details properly, this is where to start.
          </p>
        </div>

        {positions.length > 0 ? (
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {positions.map((position) => (
              <Card key={position.id} className="group overflow-hidden rounded-[1.8rem] border-white/80 bg-white/88 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)] backdrop-blur">
                <CardContent className="flex h-full flex-col gap-5 p-6">
                  <div className="flex items-start justify-between gap-3">
                    <Badge className={cn("rounded-full border px-3 py-1 text-xs font-medium", departmentClassName(position.department))}>
                      {position.department || "Team"}
                    </Badge>
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                  </div>

                  <div className="space-y-3">
                    <h2 className="text-2xl font-semibold text-foreground">{position.title}</h2>
                    <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                      {position.location ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-3 py-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {position.location}
                        </span>
                      ) : null}
                      {position.employmentType ? <span className="rounded-full bg-muted/50 px-3 py-1">{position.employmentType}</span> : null}
                    </div>
                    <p className="line-clamp-4 text-sm leading-7 text-muted-foreground">{position.description || "View the role to see full expectations, requirements, and application steps."}</p>
                  </div>

                  <div className="mt-auto pt-2">
                    <Button asChild className="rounded-full">
                      <Link href={`/apply/${position.slug}`}>
                        View & Apply
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="rounded-[1.8rem] border-dashed border-border/80 bg-white/70 shadow-none">
            <CardContent className="space-y-3 p-8 text-center">
              <p className="text-lg font-semibold text-foreground">No positions currently open.</p>
              <p className="text-sm text-muted-foreground">Check back soon or contact us if you would like to register interest for future roles.</p>
            </CardContent>
          </Card>
        )}

        <Card className="rounded-[1.8rem] border-primary/10 bg-primary/5 shadow-none">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Future opportunities</p>
              <p className="text-lg font-semibold text-foreground">Do not see the right role yet?</p>
              <p className="text-sm text-muted-foreground">Send us your details and we can keep you in mind as the team grows.</p>
            </div>
            <Button asChild variant="outline" className="rounded-full bg-white/80">
              <Link href="/contact">Contact us</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

