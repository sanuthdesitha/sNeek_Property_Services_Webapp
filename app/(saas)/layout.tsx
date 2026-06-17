import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Self-contained chrome for the SaaS product surface (the "buy sNeek" pages):
 * landing/pricing + signup. Deliberately separate from app/(public), which is a
 * tenant's own customer-facing marketing site. In the multi-tenant domain model
 * these pages live on the root/app domain; tenants get their marketing site on a
 * subdomain.
 */
export default function SaasLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/platform" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_12px] shadow-amber-400/60" />
            sNeekly
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/platform" className="text-slate-300 hover:text-white transition-colors">
              Pricing
            </Link>
            <Link href="/login" className="text-slate-300 hover:text-white transition-colors">
              Sign in
            </Link>
            <Link
              href="/get-started"
              className="rounded-full bg-amber-400 px-4 py-2 font-medium text-slate-950 hover:bg-amber-300 transition-colors"
            >
              Start free trial
            </Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-white/5 mt-24">
        <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-slate-500 flex flex-col sm:flex-row justify-between gap-4">
          <p>© sNeekly — the operating system for cleaning businesses.</p>
          <div className="flex gap-6">
            <Link href="/platform" className="hover:text-slate-300">Pricing</Link>
            <Link href="/get-started" className="hover:text-slate-300">Start free trial</Link>
            <Link href="/login" className="hover:text-slate-300">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
