import { Suspense } from "react";
import { SignupForm } from "@/components/saas/signup-form";
import { TRIAL_DAYS } from "@/lib/saas/plans";

export const metadata = {
  title: "Start your free trial — sNeek for business",
  description: `Create your cleaning-business workspace and start a ${TRIAL_DAYS}-day free trial. No card required.`,
};

export default function GetStartedPage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">
          Start your <span className="text-amber-400">{TRIAL_DAYS}-day</span> free trial
        </h1>
        <p className="mt-4 text-lg text-slate-400">
          Your own branded workspace in under a minute. No credit card, no commitment — explore every
          feature, invite your team, and run real jobs.
        </p>
        <ul className="mt-8 space-y-4 text-slate-300">
          {[
            "Full access to your plan for 30 days",
            "Import properties and invite cleaners instantly",
            "We only ask for payment if you choose to stay",
          ].map((item) => (
            <li key={item} className="flex items-start gap-3">
              <span className="mt-1 text-amber-400">✓</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
        <Suspense fallback={<div className="text-slate-400">Loading…</div>}>
          <SignupForm />
        </Suspense>
      </div>
    </div>
  );
}
