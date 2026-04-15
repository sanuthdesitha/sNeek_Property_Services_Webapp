import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";

const SERVICES = [
  { name: "Airbnb Turnover", price: "From $120", time: "2-4 hours", cleaners: "1-2", linen: true, restock: true, photos: true, report: true },
  { name: "Deep Clean", price: "From $200", time: "4-6 hours", cleaners: "1-2", linen: false, restock: false, photos: true, report: true },
  { name: "General Clean", price: "From $100", time: "2-3 hours", cleaners: "1", linen: false, restock: false, photos: false, report: true },
  { name: "End of Lease", price: "From $250", time: "5-8 hours", cleaners: "2", linen: false, restock: false, photos: true, report: true },
];

export default function ComparePage() {
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
            <h1 className="text-4xl font-bold text-text-primary tracking-tight">Compare Our Services</h1>
            <p className="mt-4 text-lg text-text-secondary">Find the right cleaning service for your needs</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-4 px-4 text-sm font-medium text-text-secondary">Feature</th>
                  {SERVICES.map((s) => (
                    <th key={s.name} className="text-center py-4 px-4">
                      <p className="font-semibold text-text-primary">{s.name}</p>
                      <p className="text-sm text-brand-600 font-medium">{s.price}</p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Est. Time", values: SERVICES.map((s) => s.time) },
                  { label: "Cleaners", values: SERVICES.map((s) => s.cleaners) },
                  { label: "Linen Management", values: SERVICES.map((s) => s.linen ? "yes" : "no") },
                  { label: "Restocking", values: SERVICES.map((s) => s.restock ? "yes" : "no") },
                  { label: "Photo Documentation", values: SERVICES.map((s) => s.photos ? "yes" : "no") },
                  { label: "Detailed Report", values: SERVICES.map((s) => s.report ? "yes" : "no") },
                ].map((row) => (
                  <tr key={row.label} className="border-b border-border">
                    <td className="py-3 px-4 text-sm text-text-secondary">{row.label}</td>
                    {row.values.map((val, i) => (
                      <td key={i} className="py-3 px-4 text-center">
                        {val === "yes" ? <Check className="h-4 w-4 text-success-600 mx-auto" /> :
                         val === "no" ? <X className="h-4 w-4 text-text-tertiary mx-auto" /> :
                         <span className="text-sm text-text-primary">{val}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
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
