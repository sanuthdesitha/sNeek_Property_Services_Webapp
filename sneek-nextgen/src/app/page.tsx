import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowRight,
  Building2,
  Shirt,
  Sparkles,
  Droplets,
  Wind,
  Home,
  Shield,
  Clock,
  Star,
  CheckCircle2,
} from "lucide-react";

const SERVICES = [
  { icon: Home, title: "Airbnb Turnover", desc: "Fast, reliable turnover cleaning between guests" },
  { icon: Sparkles, title: "Deep Clean", desc: "Thorough top-to-bottom cleaning for every space" },
  { icon: Building2, title: "End of Lease", desc: "Bond-back guaranteed cleaning service" },
  { icon: CheckCircle2, title: "General Clean", desc: "Regular maintenance cleaning on your schedule" },
  { icon: Droplets, title: "Pressure Wash", desc: "Exterior cleaning for driveways, decks, and walls" },
  { icon: Wind, title: "Window Clean", desc: "Crystal clear windows inside and out" },
  { icon: Shirt, title: "Laundry Service", desc: "Professional linen management and laundry" },
  { icon: Star, title: "Special Clean", desc: "Customized cleaning for unique requirements" },
];

const FEATURES = [
  { icon: Shield, title: "Trusted & Insured", desc: "All cleaners are vetted, trained, and fully insured" },
  { icon: Clock, title: "On-Time Guarantee", desc: "We respect your schedule with real-time GPS tracking" },
  { icon: Star, title: "Quality Assured", desc: "Every clean is reviewed with our 80% QA threshold" },
];

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-950/80 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
              <span className="text-sm font-bold text-white">S</span>
            </div>
            <span className="font-semibold text-text-primary">sNeek Property Service</span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="/services" className="text-sm text-text-secondary hover:text-text-primary transition-colors">Services</a>
            <a href="/why-us" className="text-sm text-text-secondary hover:text-text-primary transition-colors">Why Us</a>
            <a href="/faq" className="text-sm text-text-secondary hover:text-text-primary transition-colors">FAQ</a>
            <a href="/contact" className="text-sm text-text-secondary hover:text-text-primary transition-colors">Contact</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Sign In</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/quote">Get a Quote</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative py-20 lg:py-32 bg-gradient-to-b from-brand-50 to-white dark:from-neutral-900 dark:to-neutral-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-text-primary tracking-tight">
            Professional Cleaning,
            <br />
            <span className="text-brand-600">Simplified</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-text-secondary max-w-2xl mx-auto">
            From Airbnb turnovers to deep cleans, we manage every detail so you can focus on what matters. Trusted by hundreds of property owners across Sydney.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Button size="lg" asChild>
              <Link href="/quote">
                Get a Free Quote
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="/services">View Services</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-text-primary">Our Services</h2>
            <p className="mt-3 text-text-secondary max-w-xl mx-auto">
              Comprehensive cleaning solutions tailored to your property&apos;s needs
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {SERVICES.map((service) => (
              <Card key={service.title} variant="outlined" className="hover:shadow-md transition-shadow">
                <CardContent className="flex flex-col items-center text-center pt-4">
                  <div className="p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 mb-4">
                    <service.icon className="h-6 w-6 text-brand-600" />
                  </div>
                  <h3 className="font-semibold text-text-primary">{service.title}</h3>
                  <p className="text-sm text-text-secondary mt-1">{service.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 lg:py-24 bg-neutral-50 dark:bg-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-text-primary">Why Choose sNeek</h2>
            <p className="mt-3 text-text-secondary max-w-xl mx-auto">
              We&apos;re not just another cleaning company. Here&apos;s what sets us apart.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 dark:bg-brand-900/30 mb-4">
                  <feature.icon className="h-6 w-6 text-brand-600" />
                </div>
                <h3 className="font-semibold text-text-primary">{feature.title}</h3>
                <p className="text-sm text-text-secondary mt-2">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24 bg-brand-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white">Ready to Get Started?</h2>
          <p className="mt-3 text-brand-100 max-w-xl mx-auto">
            Request a free quote today and experience the sNeek difference.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Button variant="secondary" size="lg" asChild>
              <Link href="/quote">
                Request a Quote
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
            <Button
              size="lg"
              className="bg-white/10 text-white hover:bg-white/20 border border-white/20"
              asChild
            >
              <Link href="/contact">Contact Us</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
                <span className="text-sm font-bold text-white">S</span>
              </div>
              <span className="font-semibold text-text-primary">sNeek Property Service</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-text-secondary">
              <a href="/terms" className="hover:text-text-primary transition-colors">Terms</a>
              <a href="/privacy" className="hover:text-text-primary transition-colors">Privacy</a>
              <a href="/contact" className="hover:text-text-primary transition-colors">Contact</a>
            </div>
            <p className="text-sm text-text-tertiary">
              &copy; {new Date().getFullYear()} sNeek Property Service. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
