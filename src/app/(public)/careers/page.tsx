import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Briefcase, MapPin, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { ScrollReveal } from "@/components/public/scroll-reveal";

export const metadata: Metadata = {
  title: "Careers — sNeek Property Services",
  description:
    "Join the sNeek team. We&apos;re hiring cleaners, ops coordinators, and laundry partners across Melbourne.",
};

export const dynamic = "force-dynamic";

export default async function CareersPage() {
  const positions = await db.hiringPosition.findMany({
    where: { isPublished: true },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      department: true,
      location: true,
      employmentType: true,
    },
  });

  return (
    <div className="pt-20">
      <section className="bg-gray-950 py-24">
        <div className="mx-auto max-w-4xl px-6 text-center lg:px-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-brand-400">Careers</p>
          <h1 className="text-5xl font-bold text-white">Build a career with people who care.</h1>
          <p className="mt-6 text-xl leading-relaxed text-gray-400">
            We hire for discipline, kindness, and craft. If you take pride in your work and want to grow with a
            modern property services team, we&apos;d love to hear from you.
          </p>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <ScrollReveal>
            <h2 className="mb-10 text-3xl font-bold text-gray-900">Open positions</h2>
          </ScrollReveal>

          {positions.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-10 text-center">
              <Briefcase className="mx-auto mb-3 h-8 w-8 text-gray-400" />
              <p className="text-sm text-gray-600">
                No positions are open right now. Check back soon, or reach out via our contact page.
              </p>
              <Link
                href="/contact"
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
              >
                Contact us <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {positions.map((p, i) => (
                <ScrollReveal key={p.id} delay={i * 60}>
                  <Link
                    href={`/apply/${p.slug}`}
                    className="group block rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <h3 className="text-lg font-semibold text-gray-900 group-hover:text-brand-700">{p.title}</h3>
                      <ArrowRight size={16} className="mt-1 text-gray-400 transition-transform group-hover:translate-x-1 group-hover:text-brand-600" />
                    </div>
                    <div className="mb-3 flex flex-wrap gap-3 text-xs text-gray-500">
                      {p.department && (
                        <span className="inline-flex items-center gap-1">
                          <Briefcase size={12} /> {p.department}
                        </span>
                      )}
                      {p.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin size={12} /> {p.location}
                        </span>
                      )}
                      {p.employmentType && (
                        <span className="inline-flex items-center gap-1">
                          <Clock size={12} /> {p.employmentType}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-3 text-sm leading-relaxed text-gray-600">{p.description}</p>
                  </Link>
                </ScrollReveal>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-brand-700 py-16">
        <div className="mx-auto max-w-2xl px-6 text-center lg:px-8">
          <h2 className="text-3xl font-bold text-white">Don&apos;t see your role?</h2>
          <p className="mt-3 text-white/80">
            We&apos;re always meeting great people. Drop us a line and tell us about yourself.
          </p>
          <Link
            href="/contact"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-gray-50"
          >
            Get in touch <ArrowRight size={14} />
          </Link>
        </div>
      </section>
    </div>
  );
}