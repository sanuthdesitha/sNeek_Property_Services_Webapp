import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home, Calendar, Shield, Star, ArrowRight } from "lucide-react";

export default function AirbnbHostingPage() {
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-text-primary tracking-tight">Airbnb Hosting Solutions</h1>
          <p className="mt-6 text-lg text-text-secondary max-w-2xl mx-auto">Automated turnover cleaning synced with your booking calendar. Focus on hosting, we handle the rest.</p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Button size="lg" asChild><Link href="/quote">Get Started<ArrowRight className="h-4 w-4 ml-2" /></Link></Button>
            <Button variant="outline" size="lg" asChild><Link href="/compare">Compare Plans</Link></Button>
          </div>
        </div>
      </section>

      <section className="py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Calendar, title: "iCal Sync", desc: "Connect your Hospitable, Airbnb, or Booking.com calendar. Jobs are created automatically." },
              { icon: Home, title: "Guest-Ready Guarantee", desc: "Every turnover meets our 80% QA standard. Not satisfied? We re-clean for free." },
              { icon: Shield, title: "Linen Management", desc: "We handle linen counting, laundry scheduling, and restocking between guests." },
              { icon: Star, title: "24/7 Support", desc: "Emergency cleaning? Last-minute booking? We're available around the clock." },
            ].map((feature) => (
              <Card key={feature.title} variant="outlined">
                <CardContent className="pt-6 text-center">
                  <div className="p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 mb-4 inline-block">
                    <feature.icon className="h-6 w-6 text-brand-600" />
                  </div>
                  <h3 className="font-semibold text-text-primary">{feature.title}</h3>
                  <p className="text-sm text-text-secondary mt-2">{feature.desc}</p>
                </CardContent>
              </Card>
            ))}
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
