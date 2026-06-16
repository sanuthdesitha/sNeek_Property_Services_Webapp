import Link from "next/link";
import { listPlans, formatPlanPrice, TRIAL_DAYS } from "@/lib/saas/plans";

export const metadata = {
  title: "sNeek for business — the operating system for cleaning companies",
  description:
    "Jobs, scheduling, proof-of-clean, quoting, payroll and client portals in one platform. Start a 30-day free trial — no card required.",
};

const FEATURES = [
  ["Jobs & dispatch", "Schedule, assign and track every clean with live GPS and timers."],
  ["Proof of clean", "Photo/video evidence, checklists and QA reports clients trust."],
  ["Quotes → bookings", "On-brand quotes, per-job-type pricing and instant invoices."],
  ["Payroll & finance", "Timesheets, payroll runs and money summaries, automated."],
  ["Client portals", "A premium self-serve portal for every client and property."],
  ["Marketing & reviews", "Campaigns, loyalty, referrals and review collection built in."],
];

export default function PlatformPricingPage() {
  const plans = listPlans();

  return (
    <div className="mx-auto max-w-6xl px-6">
      {/* Hero */}
      <section className="py-20 sm:py-28 text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-sm text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {TRIAL_DAYS}-day free trial · no card required
        </p>
        <h1 className="mt-6 text-4xl sm:text-6xl font-semibold tracking-tight">
          Run your cleaning business
          <br />
          <span className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
            like a luxury operation
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          sNeek is the all-in-one platform for cleaning companies — jobs, proof-of-clean, quoting,
          payroll, client portals and marketing. Replace five tools with one.
        </p>
        <div className="mt-9 flex items-center justify-center gap-4">
          <Link
            href="/get-started"
            className="rounded-full bg-amber-400 px-7 py-3 font-medium text-slate-950 hover:bg-amber-300 transition-colors"
          >
            Start your free trial
          </Link>
          <Link
            href="#pricing"
            className="rounded-full border border-white/15 px-7 py-3 font-medium text-slate-200 hover:bg-white/5 transition-colors"
          >
            See pricing
          </Link>
        </div>
      </section>

      {/* Feature grid */}
      <section className="grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(([title, body]) => (
          <div key={title} className="bg-slate-950 p-7">
            <h3 className="text-lg font-medium text-white">{title}</h3>
            <p className="mt-2 text-sm text-slate-400">{body}</p>
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24">
        <div className="text-center">
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">Simple, scalable pricing</h2>
          <p className="mt-3 text-slate-400">Start free for {TRIAL_DAYS} days. Upgrade, downgrade or cancel anytime.</p>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {plans.map((plan, i) => {
            const featured = i === 1;
            return (
              <div
                key={plan.key}
                className={`relative rounded-3xl border p-8 ${
                  featured
                    ? "border-amber-400/50 bg-gradient-to-b from-amber-400/10 to-transparent shadow-[0_0_40px] shadow-amber-400/10"
                    : "border-white/10 bg-white/[0.03]"
                }`}
              >
                {featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-3 py-1 text-xs font-semibold text-slate-950">
                    Most popular
                  </span>
                )}
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                <p className="mt-2 text-sm text-slate-400 min-h-[40px]">{plan.description}</p>
                <p className="mt-6 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold">{formatPlanPrice(plan).replace("/mo", "")}</span>
                  <span className="text-slate-400">/month</span>
                </p>
                <Link
                  href={`/get-started?plan=${plan.key}`}
                  className={`mt-6 block rounded-full px-5 py-3 text-center font-medium transition-colors ${
                    featured
                      ? "bg-amber-400 text-slate-950 hover:bg-amber-300"
                      : "border border-white/15 text-slate-200 hover:bg-white/5"
                  }`}
                >
                  Start free trial
                </Link>
                <ul className="mt-8 space-y-3 text-sm">
                  {plan.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2 text-slate-300">
                      <span className="mt-1 text-amber-400">✓</span>
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mt-8 text-center text-sm text-slate-500">
          Prices in AUD, ex-GST. Every plan includes the {TRIAL_DAYS}-day free trial with no card required.
        </p>
      </section>
    </div>
  );
}
