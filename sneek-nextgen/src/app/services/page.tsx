import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Home,
  Sparkles,
  Building2,
  CheckCircle2,
  Droplets,
  Wind,
  Shirt,
  Star,
  ArrowRight,
  Trees,
  Hammer,
  Waves,
  Flower2,
  Brush,
  BrickWall,
  Leaf,
} from "lucide-react";

const SERVICES = [
  { icon: Home, title: "Airbnb Turnover", desc: "Fast, reliable turnover cleaning between guests. We handle bed stripping, bathroom sanitizing, kitchen cleaning, and linen management.", href: "/cleaning/airbnb-turnover" },
  { icon: Sparkles, title: "Deep Clean", desc: "Thorough top-to-bottom cleaning including baseboards, light fixtures, ceiling fans, and inside appliances.", href: "/cleaning/deep-clean" },
  { icon: Building2, title: "End of Lease", desc: "Bond-back guaranteed cleaning service. Real estate approved checklists for a smooth handover.", href: "/cleaning/end-of-lease" },
  { icon: CheckCircle2, title: "General Clean", desc: "Regular maintenance cleaning on your schedule. Perfect for ongoing property upkeep.", href: "/cleaning/general-clean" },
  { icon: Hammer, title: "Post Construction", desc: "Heavy-duty cleaning after renovations or new builds. Dust removal, debris cleanup, and surface polishing.", href: "/cleaning/post-construction" },
  { icon: Droplets, title: "Pressure Wash", desc: "Exterior cleaning for driveways, decks, walls, and outdoor areas. Restore your property's curb appeal.", href: "/cleaning/pressure-wash" },
  { icon: Wind, title: "Window Clean", desc: "Crystal clear windows inside and out. Tracks, sills, and screens included.", href: "/cleaning/window-clean" },
  { icon: Trees, title: "Lawn Mowing", desc: "Professional lawn care including mowing, edging, and garden tidy-up.", href: "/cleaning/lawn-mowing" },
  { icon: Star, title: "Special Clean", desc: "Customized cleaning for unique requirements. Tell us what you need and we'll make it happen.", href: "/cleaning/special-clean" },
  { icon: Building2, title: "Commercial Recurring", desc: "Regular office and commercial space cleaning. Flexible scheduling to suit your business hours.", href: "/cleaning/commercial-recurring" },
  { icon: Waves, title: "Carpet Steam Clean", desc: "Deep carpet cleaning with hot water extraction. Removes stains, allergens, and odors.", href: "/cleaning/carpet-steam-clean" },
  { icon: Flower2, title: "Mold Treatment", desc: "Professional mold identification and treatment. Safe for families and pets.", href: "/cleaning/mold-treatment" },
  { icon: Brush, title: "Upholstery Cleaning", desc: "Fabric and leather furniture cleaning. Restore your furniture to like-new condition.", href: "/cleaning/upholstery-cleaning" },
  { icon: BrickWall, title: "Tile & Grout Cleaning", desc: "Deep tile and grout cleaning for kitchens, bathrooms, and outdoor areas.", href: "/cleaning/tile-grout-cleaning" },
  { icon: Leaf, title: "Gutter Cleaning", desc: "Safe and thorough gutter cleaning. Prevent water damage and pest infestations.", href: "/cleaning/gutter-cleaning" },
  { icon: Sparkles, title: "Spring Cleaning", desc: "Comprehensive seasonal deep clean. Perfect for refreshing your home after winter.", href: "/cleaning/spring-cleaning" },
];

export default function ServicesPage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
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

      {/* Hero */}
      <section className="py-16 lg:py-24 bg-gradient-to-b from-brand-50 to-white dark:from-neutral-900 dark:to-neutral-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-text-primary tracking-tight">Our Services</h1>
          <p className="mt-6 text-lg text-text-secondary max-w-2xl mx-auto">
            Comprehensive cleaning solutions for every property type and need. From Airbnb turnovers to deep cleans, we&apos;ve got you covered.
          </p>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {SERVICES.map((service) => (
              <Card key={service.title} variant="outlined" className="hover:shadow-md transition-shadow group">
                <CardContent className="flex flex-col items-center text-center pt-6">
                  <div className="p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 mb-4">
                    <service.icon className="h-6 w-6 text-brand-600" />
                  </div>
                  <h3 className="font-semibold text-text-primary">{service.title}</h3>
                  <p className="text-sm text-text-secondary mt-2 line-clamp-3">{service.desc}</p>
                  <Button variant="ghost" size="sm" className="mt-4 group-hover:text-brand-600" asChild>
                    <Link href={service.href}>
                      Learn More
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-brand-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white">Need a Custom Solution?</h2>
          <p className="mt-3 text-brand-100 max-w-xl mx-auto">
            Can&apos;t find what you&apos;re looking for? We offer customized cleaning packages tailored to your specific needs.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Button variant="secondary" size="lg" asChild><Link href="/quote">Request a Quote</Link></Button>
            <Button size="lg" className="bg-white/10 text-white hover:bg-white/20 border border-white/20" asChild><Link href="/contact">Contact Us</Link></Button>
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
