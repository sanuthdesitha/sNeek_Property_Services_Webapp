import Link from "next/link";

export default function PrivacyPage() {
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
          <h1 className="text-3xl font-bold text-text-primary mb-8">Privacy Policy</h1>
          <div className="prose prose-neutral dark:prose-invert max-w-none text-text-secondary">
            <p>Last updated: April 15, 2026</p>
            <h2 className="text-xl font-semibold text-text-primary mt-8 mb-4">1. Information We Collect</h2>
            <p>We collect personal information including name, email, phone number, and address when you register for our services. We also collect GPS location data from cleaners during active job shifts.</p>
            <h2 className="text-xl font-semibold text-text-primary mt-8 mb-4">2. How We Use Your Information</h2>
            <p>Your information is used to provide cleaning services, process payments, send notifications, and improve our platform. GPS data is used solely for job tracking and route optimization.</p>
            <h2 className="text-xl font-semibold text-text-primary mt-8 mb-4">3. Data Storage</h2>
            <p>All data is stored securely on encrypted servers. Photos and documents are stored on S3-compatible storage with encryption at rest.</p>
            <h2 className="text-xl font-semibold text-text-primary mt-8 mb-4">4. Third-Party Sharing</h2>
            <p>We may share limited information with third-party service providers (Stripe for payments, Resend for emails, Xero for accounting). We do not sell your personal information.</p>
            <h2 className="text-xl font-semibold text-text-primary mt-8 mb-4">5. Your Rights</h2>
            <p>You have the right to access, correct, or delete your personal information at any time. Contact us at privacy@sneekops.com.au for any privacy-related requests.</p>
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
