import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function TermsPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-950/80 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><span className="text-sm font-bold text-white">S</span></div>
            <span className="font-semibold text-text-primary">sNeek Property Service</span>
          </Link>
        </div>
      </header>

      <section className="py-16 lg:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-text-primary mb-8">Terms of Service</h1>
          <div className="prose prose-neutral dark:prose-invert max-w-none text-text-secondary">
            <p>Last updated: April 15, 2026</p>
            <h2 className="text-xl font-semibold text-text-primary mt-8 mb-4">1. Acceptance of Terms</h2>
            <p>By accessing and using the sNeek Property Service platform, you accept and agree to be bound by these Terms of Service.</p>
            <h2 className="text-xl font-semibold text-text-primary mt-8 mb-4">2. Services</h2>
            <p>sNeek Property Service provides professional cleaning services including but not limited to Airbnb turnovers, deep cleans, end of lease cleans, and general maintenance cleaning.</p>
            <h2 className="text-xl font-semibold text-text-primary mt-8 mb-4">3. Cancellation Policy</h2>
            <p>We require 24 hours notice for cancellations. Cancellations within 24 hours may incur a fee equivalent to 50% of the scheduled service cost.</p>
            <h2 className="text-xl font-semibold text-text-primary mt-8 mb-4">4. Liability</h2>
            <p>sNeek Property Service carries public liability insurance up to $20 million. Any claims must be reported within 24 hours of the service.</p>
            <h2 className="text-xl font-semibold text-text-primary mt-8 mb-4">5. Payment Terms</h2>
            <p>Payment is due within 14 days of invoice date. Late payments may incur interest charges at 2% per month.</p>
          </div>
        </div>
      </section>

      <footer className="py-12 border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><span className="text-sm font-bold text-white">S</span></div>
              <span className="font-semibold text-text-primary">sNeek Property Service</span>
            </div>
            <p className="text-sm text-text-tertiary">&copy; {new Date().getFullYear()} sNeek Property Service. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
