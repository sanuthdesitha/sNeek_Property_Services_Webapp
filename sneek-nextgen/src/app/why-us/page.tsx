import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Shield, Clock, Star, Users, Award } from "lucide-react";

const REASONS = [
  { icon: Shield, title: "Fully Insured & Bonded", desc: "Every cleaner is vetted, background-checked, and fully insured for your peace of mind." },
  { icon: Clock, title: "On-Time Guarantee", desc: "We respect your schedule with real-time GPS tracking and proactive communication." },
  { icon: Star, title: "Quality Assured", desc: "Every clean is reviewed with our 80% QA threshold. Not satisfied? We'll re-clean for free." },
  { icon: Users, title: "Dedicated Team", desc: "Same cleaner assigned to your property for consistency and familiarity." },
  { icon: Award, title: "Eco-Friendly Products", desc: "We use environmentally friendly cleaning products that are safe for families and pets." },
  { icon: CheckCircle2, title: "Bond-Back Guarantee", desc: "Our end-of-lease cleans come with a bond-back guarantee approved by major real estate agencies." },
];

const TESTIMONIALS = [
  { name: "Sarah M.", role: "Property Manager", text: "sNeek has been our go-to cleaning service for 2 years. Reliable, thorough, and always professional.", rating: 5 },
  { name: "James T.", role: "Airbnb Host", text: "The iCal integration is a game-changer. Jobs are automatically created when guests book. Brilliant!", rating: 5 },
  { name: "Lisa K.", role: "Homeowner", text: "Best deep clean we've ever had. They even got stains out that we thought were permanent.", rating: 5 },
];

export default function WhyUsPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-950/80 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
              <span className="text-sm font-bold text-white">S</span>
            </div>
            <span className="font-semibold text-text-primary">sNeek Property Service</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild><Link href="/login">Sign In</Link></Button>
            <Button size="sm" asChild><Link href="/quote">Get a Quote</Link></Button>
          </div>
        </div>
      </header>

      <section className="py-16 lg:py-24 bg-gradient-to-b from-brand-50 to-white dark:from-neutral-900 dark:to-neutral-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-text-primary tracking-tight">Why Choose sNeek</h1>
          <p className="mt-6 text-lg text-text-secondary max-w-2xl mx-auto">
            We&apos;re not just another cleaning company. Here&apos;s what sets us apart from the rest.
          </p>
        </div>
      </section>

      <section className="py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {REASONS.map((reason) => (
              <Card key={reason.title} variant="outlined">
                <CardContent className="pt-6">
                  <div className="p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 mb-4 inline-block">
                    <reason.icon className="h-6 w-6 text-brand-600" />
                  </div>
                  <h3 className="font-semibold text-text-primary text-lg">{reason.title}</h3>
                  <p className="text-sm text-text-secondary mt-2">{reason.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-neutral-50 dark:bg-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-text-primary text-center mb-12">What Our Clients Say</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
              <Card key={t.name} variant="outlined">
                <CardContent className="pt-6">
                  <div className="flex gap-1 mb-3">
                    {Array.from({ length: t.rating }).map((_, i) => (
                      <Star key={i} className="h-4 w-4 fill-warning-500 text-warning-500" />
                    ))}
                  </div>
                  <p className="text-sm text-text-secondary italic">&ldquo;{t.text}&rdquo;</p>
                  <div className="mt-4">
                    <p className="font-medium text-sm">{t.name}</p>
                    <p className="text-xs text-text-tertiary">{t.role}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-brand-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white">Ready to Experience the Difference?</h2>
          <p className="mt-3 text-brand-100 max-w-xl mx-auto">Get a free quote today and see why hundreds of property owners trust sNeek.</p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Button variant="secondary" size="lg" asChild><Link href="/quote">Request a Quote</Link></Button>
            <Button size="lg" className="bg-white/10 text-white hover:bg-white/20 border border-white/20" asChild><Link href="/contact">Contact Us</Link></Button>
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
            <div className="flex items-center gap-6 text-sm text-text-secondary">
              <Link href="/terms" className="hover:text-text-primary transition-colors">Terms</Link>
              <Link href="/privacy" className="hover:text-text-primary transition-colors">Privacy</Link>
              <Link href="/contact" className="hover:text-text-primary transition-colors">Contact</Link>
            </div>
            <p className="text-sm text-text-tertiary">&copy; {new Date().getFullYear()} sNeek Property Service. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
