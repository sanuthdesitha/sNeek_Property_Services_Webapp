import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ArrowRight, Star, Shield, Clock } from "lucide-react";

const SERVICE_DETAILS: Record<string, { title: string; desc: string; features: string[]; price: string; time: string }> = {
  "airbnb-turnover": { title: "Airbnb Turnover Cleaning", desc: "Fast, reliable turnover cleaning between guests. We handle everything from bed stripping to final staging checks.", features: ["Bed strip and remake", "Bathroom sanitizing and restocking", "Kitchen deep clean", "Living area dust and vacuum", "Balcony sweep and wipe", "Linen count and laundry scheduling", "Lost item check", "Photo documentation"], price: "From $120", time: "2-4 hours" },
  "deep-clean": { title: "Deep Cleaning", desc: "Thorough top-to-bottom cleaning for properties that need extra attention.", features: ["Detailed dusting of all surfaces", "Baseboards and skirting boards", "Light fixtures and ceiling fans", "Inside all appliances", "Cabinet fronts and backsplash", "Grout and tile cleaning", "Window tracks and sills", "Exhaust fan cleaning"], price: "From $200", time: "4-6 hours" },
  "end-of-lease": { title: "End of Lease Cleaning", desc: "Bond-back guaranteed cleaning service approved by major real estate agencies.", features: ["Full property clean", "Carpet cleaning included", "Window cleaning (interior)", "Oven and appliance cleaning", "Wall spot cleaning", "Light fixture cleaning", "Garage sweep", "Real estate handover ready"], price: "From $250", time: "5-8 hours" },
  "general-clean": { title: "General Cleaning", desc: "Regular maintenance cleaning for ongoing property upkeep.", features: ["Surface dusting", "Vacuum and mop floors", "Bathroom cleaning", "Kitchen wipe-down", "Bin empty", "Light tidying", "Mirror cleaning", "Trash removal"], price: "From $100", time: "2-3 hours" },
};

export default async function CleaningTypePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const service = SERVICE_DETAILS[type] ?? {
    title: type.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    desc: "Professional cleaning service tailored to your needs.",
    features: ["Customized cleaning plan", "Professional equipment", "Experienced cleaners", "Photo documentation"],
    price: "Contact us",
    time: "Varies",
  };

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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-bold text-text-primary tracking-tight">{service.title}</h1>
            <p className="mt-4 text-lg text-text-secondary">{service.desc}</p>
            <div className="flex items-center gap-4 mt-6">
              <span className="text-2xl font-bold text-brand-600">{service.price}</span>
              <span className="text-text-tertiary">&middot;</span>
              <span className="text-text-secondary">{service.time}</span>
            </div>
            <div className="flex items-center gap-4 mt-8">
              <Button size="lg" asChild><Link href="/quote">Get a Quote<ArrowRight className="h-4 w-4 ml-2" /></Link></Button>
              <Button variant="outline" size="lg" asChild><Link href="/compare">Compare Services</Link></Button>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-text-primary mb-8">What&apos;s Included</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {service.features.map((feature) => (
              <div key={feature} className="flex items-start gap-3 p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <CheckCircle2 className="h-5 w-5 text-success-600 mt-0.5 shrink-0" />
                <span className="text-sm text-text-primary">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-neutral-50 dark:bg-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Shield, title: "Fully Insured", desc: "All cleaners are vetted and insured" },
              { icon: Clock, title: "On-Time Guarantee", desc: "We respect your schedule" },
              { icon: Star, title: "Quality Assured", desc: "80% QA threshold on every clean" },
            ].map((f) => (
              <div key={f.title} className="text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 dark:bg-brand-900/30 mb-3">
                  <f.icon className="h-5 w-5 text-brand-600" />
                </div>
                <h3 className="font-semibold text-text-primary">{f.title}</h3>
                <p className="text-sm text-text-secondary mt-1">{f.desc}</p>
              </div>
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
