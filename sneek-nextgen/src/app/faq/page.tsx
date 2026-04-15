import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const FAQS = [
  { q: "What areas do you service?", a: "We service the greater Sydney metropolitan area, including the CBD, Eastern Suburbs, Northern Beaches, Inner West, and surrounding areas." },
  { q: "Do I need to be home during the clean?", a: "No, you don't need to be home. Most of our clients provide access via lockbox, key code, or concierge. We'll send you a notification when your cleaner arrives and departs." },
  { q: "What cleaning products do you use?", a: "We use eco-friendly, non-toxic cleaning products that are safe for families, pets, and the environment. If you have specific product preferences, let us know." },
  { q: "Are your cleaners insured?", a: "Yes, all our cleaners are fully insured, background-checked, and professionally trained. We carry public liability insurance up to $20 million." },
  { q: "What if I'm not satisfied with the clean?", a: "We have an 80% QA threshold on every clean. If you're not satisfied, contact us within 24 hours and we'll arrange a re-clean at no extra cost." },
  { q: "How do I book a clean?", a: "You can request a quote through our website, call us directly, or if you're an existing client, book through your client portal." },
  { q: "Do you bring your own equipment?", a: "Yes, our cleaners bring all necessary equipment and supplies. If you prefer us to use your equipment, just let us know." },
  { q: "What is your cancellation policy?", a: "We require 24 hours notice for cancellations. Cancellations within 24 hours may incur a fee." },
  { q: "Do you offer regular cleaning schedules?", a: "Yes! We offer weekly, fortnightly, and monthly cleaning schedules with discounted rates for recurring clients." },
  { q: "How does the iCal integration work?", a: "For Airbnb hosts, we can connect to your Hospitable or other booking platform's iCal feed. This automatically creates cleaning jobs when new bookings are made." },
];

export default function FAQPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-950/80 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><span className="text-sm font-bold text-white">S</span></div>
            <span className="font-semibold text-text-primary">sNeek Property Service</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild><Link href="/login">Sign In</Link></Button>
            <Button size="sm" asChild><Link href="/quote">Get a Quote</Link></Button>
          </div>
        </div>
      </header>

      <section className="py-16 lg:py-24 bg-gradient-to-b from-brand-50 to-white dark:from-neutral-900 dark:to-neutral-950">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-text-primary tracking-tight">Frequently Asked Questions</h1>
            <p className="mt-4 text-lg text-text-secondary">Everything you need to know about our services</p>
          </div>

          <div className="space-y-4">
            {FAQS.map((faq, i) => (
              <Card key={i} variant="outlined">
                <CardContent className="pt-6">
                  <h3 className="font-semibold text-text-primary">{faq.q}</h3>
                  <p className="text-sm text-text-secondary mt-2">{faq.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center mt-12">
            <p className="text-text-secondary mb-4">Still have questions?</p>
            <Button asChild><Link href="/contact">Contact Us</Link></Button>
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
