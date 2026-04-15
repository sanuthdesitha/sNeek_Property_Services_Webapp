import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { ArrowRight, CheckCircle2, Star, Shield, Clock } from "lucide-react";

export default function QuotePage() {
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
          </div>
        </div>
      </header>

      <section className="py-16 lg:py-24 bg-gradient-to-b from-brand-50 to-white dark:from-neutral-900 dark:to-neutral-950">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-text-primary tracking-tight">Get a Free Quote</h1>
            <p className="mt-4 text-lg text-text-secondary">Tell us about your property and cleaning needs. We&apos;ll get back to you within 24 hours.</p>
          </div>

          <Card variant="outlined">
            <CardContent className="pt-6">
              <form className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="Full Name" placeholder="John Doe" required />
                  <Input label="Email" type="email" placeholder="john@example.com" required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="Phone" type="tel" placeholder="+61 400 000 000" />
                  <Select
                    label="Service Type"
                    options={[
                      { value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" },
                      { value: "DEEP_CLEAN", label: "Deep Clean" },
                      { value: "END_OF_LEASE", label: "End of Lease" },
                      { value: "GENERAL_CLEAN", label: "General Clean" },
                      { value: "POST_CONSTRUCTION", label: "Post Construction" },
                      { value: "PRESSURE_WASH", label: "Pressure Wash" },
                      { value: "WINDOW_CLEAN", label: "Window Clean" },
                      { value: "OTHER", label: "Other" },
                    ]}
                    placeholder="Select service"
                    required
                  />
                </div>
                <Input label="Property Address" placeholder="123 Harbour Street, Sydney NSW 2000" required />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Input label="Bedrooms" type="number" min={1} placeholder="2" />
                  <Input label="Bathrooms" type="number" min={1} placeholder="1" />
                  <Select label="Balcony?" options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} placeholder="Select" />
                  <Select label="Condition" options={[{ value: "light", label: "Light" }, { value: "standard", label: "Standard" }, { value: "heavy", label: "Heavy" }]} placeholder="Select" />
                </div>
                <Textarea label="Additional Notes" placeholder="Any special requirements or requests..." />
                <Button type="submit" className="w-full" size="lg">
                  Submit Quote Request
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-12">
            {[
              { icon: Clock, title: "24hr Response", desc: "We'll get back to you within 24 hours" },
              { icon: Shield, title: "No Obligation", desc: "Free quote with no commitment required" },
              { icon: Star, title: "Trusted Service", desc: "Hundreds of satisfied clients across Sydney" },
            ].map((feature) => (
              <div key={feature.title} className="text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 dark:bg-brand-900/30 mb-3">
                  <feature.icon className="h-5 w-5 text-brand-600" />
                </div>
                <h3 className="font-semibold text-text-primary">{feature.title}</h3>
                <p className="text-sm text-text-secondary mt-1">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="py-12 border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
                <span className="text-sm font-bold text-white">S</span>
              </div>
              <span className="font-semibold text-text-primary">sNeek Property Service</span>
            </div>
            <p className="text-sm text-text-tertiary">&copy; {new Date().getFullYear()} sNeek Property Service. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
