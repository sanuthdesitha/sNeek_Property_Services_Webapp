import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

const PLANS = [
  { name: "Weekly Clean", price: "$130", period: "/week", popular: false, features: ["Weekly scheduled cleaning", "Same cleaner assigned", "Priority booking", "Monthly quality review", "Inventory management included"] },
  { name: "Fortnightly Clean", price: "$150", period: "/fortnight", popular: true, features: ["Fortnightly scheduled cleaning", "Flexible scheduling", "Quality assurance", "Inventory management included", "10% discount on add-ons"] },
  { name: "Monthly Clean", price: "$200", period: "/month", popular: false, features: ["Monthly deep clean", "Comprehensive checklist", "Photo documentation", "Detailed report", "15% discount on add-ons"] },
  { name: "Airbnb Hosting", price: "$120", period: "/turnover", popular: false, features: ["iCal integration", "Express turnaround", "Linen management", "Guest-ready guarantee", "Restocking service", "24/7 support"] },
];

export default function SubscriptionsPage() {
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
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-text-primary tracking-tight">Subscription Plans</h1>
            <p className="mt-4 text-lg text-text-secondary">Choose the plan that works best for your property</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {PLANS.map((plan) => (
              <Card key={plan.name} variant="outlined" className={plan.popular ? "ring-2 ring-brand-500" : ""}>
                <CardContent className="pt-6">
                  {plan.popular && <Badge variant="default" className="mb-3">Most Popular</Badge>}
                  <h3 className="text-lg font-semibold text-text-primary">{plan.name}</h3>
                  <div className="mt-2">
                    <span className="text-3xl font-bold text-text-primary">{plan.price}</span>
                    <span className="text-text-tertiary">{plan.period}</span>
                  </div>
                  <ul className="mt-6 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm text-text-secondary">
                        <Check className="h-4 w-4 text-success-600 mt-0.5 shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Button className="w-full mt-6" variant={plan.popular ? "primary" : "outline"} asChild>
                    <Link href="/quote">Get Started</Link>
                  </Button>
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
