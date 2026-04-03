"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Mail,
  MapPin,
  Menu,
  Phone,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PUBLIC_SITE_NAV } from "@/lib/rebuild/navigation";
import { MARKETED_SERVICES, SERVICE_FAMILY_META } from "@/lib/marketing/catalog";
import type { ServiceFamily } from "@/lib/marketing/catalog";
import type { WebsiteContent } from "@/lib/public-site/content";

interface PublicSiteShellProps {
  children: React.ReactNode;
  companyName: string;
  logoUrl?: string | null;
  content: WebsiteContent;
}

export const PUBLIC_PAGE_CONTAINER = "public-page-container w-full mx-auto px-5 sm:px-8 lg:px-12 xl:px-16";

const WHATSAPP_FALLBACK_NUMBER = "61451217210";
const SERVICE_FAMILIES: ServiceFamily[] = ["short_stay", "residential", "specialty", "exterior", "commercial"];
const ANNOUNCEMENT_BAR_THEME_CLASSES: Record<WebsiteContent["announcementBar"]["bgStyle"], string> = {
  subtle: "border-primary/10 bg-primary/6 text-foreground/70",
  accent: "border-amber-200 bg-amber-50 text-amber-900",
  dark: "border-white/10 bg-[#0c2329] text-white/80",
  warning: "border-red-200 bg-red-50 text-red-800",
};

const familyFirstSlug: Record<ServiceFamily, string> = SERVICE_FAMILIES.reduce(
  (acc, family) => {
    const first = MARKETED_SERVICES.find((service) => service.family === family);
    acc[family] = first ? `/services/${first.slug}` : "/services";
    return acc;
  },
  {} as Record<ServiceFamily, string>
);

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export function PublicSiteShell({ children, companyName, logoUrl, content }: PublicSiteShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [expandedFamilies, setExpandedFamilies] = useState<Set<ServiceFamily>>(() => new Set());
  const [scrolled, setScrolled] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const initials = useMemo(() => initialsFromName(companyName) || "SP", [companyName]);
  const serviceGroups = useMemo(
    () =>
      SERVICE_FAMILIES.map((family) => ({
        family,
        meta: SERVICE_FAMILY_META[family],
        services: MARKETED_SERVICES.filter((service) => service.family === family),
      })),
    []
  );

  const navItems = PUBLIC_SITE_NAV.filter((item) => item.href !== "/login" && item.href !== "/quote");
  const hideWhatsApp = pathname === "/quote" || pathname === "/contact";
  const announcementBar = content.announcementBar;
  const announcementBarThemeClass = ANNOUNCEMENT_BAR_THEME_CLASSES[announcementBar.bgStyle] ?? ANNOUNCEMENT_BAR_THEME_CLASSES.subtle;
  const displayPhone = content.contact.displayPhone || "+61 451 217 210";
  const telHref = `tel:${displayPhone.replace(/\s+/g, "")}`;
  const displayEmail = content.contact.displayEmail || "info@sneekproservices.com.au";
  const displayLocation = content.contact.addressLine || "Parramatta, NSW 2150";
  const whatsappNumber = content.socialLinks?.whatsapp?.replace(/\D/g, "") || WHATSAPP_FALLBACK_NUMBER;
  const whatsappHref = `https://wa.me/${whatsappNumber}`;
  const { socialLinks } = content;

  useEffect(() => {
    setMobileOpen(false);
    setServicesOpen(false);
  }, [pathname]);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 8);
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const toggleFamily = (family: ServiceFamily) => {
    setExpandedFamilies((current) => {
      const next = new Set(current);
      if (next.has(family)) {
        next.delete(family);
      } else {
        next.add(family);
      }
      return next;
    });
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground" style={{ "--container-max-w": content.containerWidth || "80%" } as React.CSSProperties}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_12%,rgba(255,177,95,0.16),transparent_28%),radial-gradient(circle_at_92%_6%,rgba(37,169,184,0.16),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.95),rgba(249,246,240,0.94))]" />
      <div className="pointer-events-none absolute left-[4%] top-24 h-40 w-40 rounded-full bg-primary/10 blur-3xl motion-safe:animate-float-slow" />
      <div className="pointer-events-none absolute right-[5%] top-52 h-56 w-56 rounded-full bg-accent/70 blur-3xl motion-safe:animate-float-slower" />

      {announcementBar.enabled ? (
        <div className={cn("hidden border-b sm:block", announcementBarThemeClass)}>
          {announcementBar.promoMessage ? (
            <div className="border-b border-current/10">
              <div className={cn(PUBLIC_PAGE_CONTAINER, "flex items-center justify-center py-2 text-center text-sm font-medium")}>
                {announcementBar.promoLink ? (
                  <a href={announcementBar.promoLink} className="inline-flex flex-wrap items-center justify-center gap-2 hover:opacity-90">
                    <span>{announcementBar.promoMessage}</span>
                    <span className="font-semibold">{announcementBar.promoLinkLabel || "Book now ->"}</span>
                  </a>
                ) : (
                  <span>{announcementBar.promoMessage}</span>
                )}
              </div>
            </div>
          ) : null}
          <div className={cn(PUBLIC_PAGE_CONTAINER, "flex items-center justify-between gap-3 py-2")}>
            <div className="flex flex-wrap items-center gap-5 text-xs">
              {announcementBar.showPhone ? (
                <a href={telHref} className="flex items-center gap-1.5 transition-colors hover:text-primary">
                  <Phone className="h-3 w-3" />
                  {displayPhone}
                </a>
              ) : null}
              {announcementBar.showLocation ? (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 text-primary" />
                  {displayLocation}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 text-xs">
              {announcementBar.showHours ? <span>Mon-Sat 7am - 6pm</span> : null}
              {announcementBar.showEmail ? (
                <a href={`mailto:${displayEmail}`} className="flex items-center gap-1 transition-colors hover:text-primary">
                  <Mail className="h-3 w-3" />
                  {displayEmail}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <header className={cn("sticky top-0 z-50 border-b transition-all duration-300", scrolled ? "border-white/80 bg-white/92 shadow-[0_4px_24px_-8px_rgba(23,73,78,0.15)] backdrop-blur-xl" : "border-white/50 bg-white/80 backdrop-blur-lg")}>
        <div className={cn(PUBLIC_PAGE_CONTAINER, "flex items-center justify-between gap-3 py-3 sm:gap-4 sm:py-3.5")}>
          <div className="flex min-w-0 items-center gap-4 lg:gap-6 xl:gap-8">
            <Link href="/" className="flex min-w-0 items-center gap-3">
              {logoUrl ? (
                <img src={logoUrl} alt={`${companyName} logo`} className="h-10 w-10 rounded-2xl bg-white p-1 object-cover shadow-sm sm:h-11 sm:w-11" loading="lazy" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary shadow-sm sm:h-11 sm:w-11">
                  <span className="text-sm font-bold text-white">{initials}</span>
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold sm:text-base">{companyName}</p>
                <p className="hidden truncate text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:block">Property cleaning &amp; hosting support</p>
              </div>
            </Link>

            <nav className="hidden items-center gap-0.5 xl:flex">
              {navItems.map((item) => {
                if (item.href === "/services") {
                  const isActive = pathname === "/services" || pathname.startsWith("/services/");
                  return (
                    <div key={item.href} className="relative" onMouseEnter={() => setServicesOpen(true)} onMouseLeave={() => setServicesOpen(false)}>
                      <Link
                        href="/services"
                        className={cn(
                          "flex items-center gap-1 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all duration-200 hover:-translate-y-0.5",
                          isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-white hover:text-foreground"
                        )}
                        aria-expanded={servicesOpen}
                      >
                        {item.label}
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", servicesOpen && "rotate-180")} />
                      </Link>

                      {servicesOpen ? (
                        <div className="absolute left-0 top-full z-50 mt-1.5 w-[22rem] max-h-[70vh] overflow-y-auto rounded-2xl border border-white/80 bg-white shadow-[0_20px_60px_-20px_rgba(23,73,78,0.3)] backdrop-blur-xl">
                          <div className="space-y-2 p-3">
                            {serviceGroups.map(({ family, meta, services }) => {
                              const isExpanded = expandedFamilies.has(family);
                              return (
                                <div key={family} className="rounded-xl border border-border/60 bg-white/90">
                                  <button
                                    type="button"
                                    onClick={() => toggleFamily(family)}
                                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-primary/6"
                                  >
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-foreground">{meta.label}</span>
                                        <span className="rounded-full bg-primary/8 px-2 py-0.5 text-[11px] font-semibold text-primary">{services.length}</span>
                                      </div>
                                      <p className="line-clamp-1 text-xs text-muted-foreground">{meta.description}</p>
                                    </div>
                                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                                  </button>
                                  {isExpanded ? (
                                    <div className="space-y-1 border-t border-border/60 px-2 py-2">
                                      {services.map((service) => (
                                        <Link
                                          key={service.slug}
                                          href={`/services/${service.slug}`}
                                          className="flex items-center justify-between rounded-lg py-1.5 pl-4 pr-3 text-sm text-foreground/80 transition-colors hover:bg-primary/6 hover:text-primary"
                                        >
                                          <span>{service.label}</span>
                                          <span aria-hidden="true">-&gt;</span>
                                        </Link>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                            <div className="mt-1 border-t border-border/50 pt-2">
                              <Link href="/services" className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/6">
                                View all 15 services -&gt;
                              </Link>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                }

                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all duration-200 hover:-translate-y-0.5",
                      active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-white hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <Button variant="ghost" asChild className="rounded-full text-sm" size="sm">
              <Link href="/login">Login</Link>
            </Button>
            <Button asChild className="rounded-full shadow-sm transition-transform duration-200 hover:-translate-y-0.5" size="sm">
              <Link href="/quote">Instant Quote</Link>
            </Button>
          </div>

          <Button variant="outline" size="icon" className="rounded-full lg:hidden" onClick={() => setMobileOpen((current) => !current)} aria-label={mobileOpen ? "Close site menu" : "Open site menu"}>
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>

        {mobileOpen ? (
          <div className="border-t border-white/60 bg-white/98 px-4 pb-6 pt-4 shadow-lg lg:hidden">
            <div className="mb-4 flex items-center gap-4 rounded-2xl bg-primary/6 px-4 py-3 text-sm">
              <a href={telHref} className="flex items-center gap-1.5 font-medium text-primary">
                <Phone className="h-3.5 w-3.5" />
                {displayPhone}
              </a>
            </div>
            <nav className="space-y-1.5">
              {navItems.map((item) => {
                const active = pathname === item.href || (item.href === "/services" && pathname.startsWith("/services"));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "block rounded-2xl px-4 py-3 text-sm font-medium transition-colors",
                      active ? "bg-primary text-primary-foreground" : "bg-white/80 text-foreground hover:bg-white"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button variant="outline" asChild className="rounded-2xl">
                  <Link href="/login">Login</Link>
                </Button>
                <Button asChild className="rounded-2xl">
                  <Link href="/quote">Instant Quote</Link>
                </Button>
              </div>
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <WhatsAppIcon className="h-4 w-4" />
                Chat on WhatsApp
              </a>
            </nav>
          </div>
        ) : null}
      </header>

      <main className="relative z-10 page-fade">{children}</main>

      <footer className="relative z-10 bg-[#0c2329] text-white">
        <div className={cn(PUBLIC_PAGE_CONTAINER, "grid gap-10 py-12 sm:py-14 lg:grid-cols-[1.4fr_repeat(3,1fr)] lg:gap-12")}>
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img src={logoUrl} alt={`${companyName} logo`} className="h-11 w-11 rounded-2xl bg-white/10 p-1 object-cover" loading="lazy" />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/80 shadow-sm">
                  <span className="text-sm font-bold text-white">{initials}</span>
                </div>
              )}
              <div className="min-w-0">
                <p className="font-semibold text-white">{companyName}</p>
                <p className="text-xs text-white/55">Property cleaning &amp; hosting support</p>
              </div>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-medium text-white/80">
              $5M Public Liability Insured
            </div>

            <p className="text-sm leading-7 text-white/60">{content.footer.blurb}</p>

            <div className="flex items-center gap-2">
              {socialLinks?.whatsapp ? (
                <a href={`https://wa.me/${socialLinks.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-white/60 transition-colors hover:bg-[#25D366] hover:text-white" aria-label="WhatsApp">
                  <WhatsAppIcon className="h-4 w-4" />
                </a>
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/25" aria-hidden="true">
                  <WhatsAppIcon className="h-4 w-4" />
                </span>
              )}
              {socialLinks?.instagram ? (
                <a href={socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-white/60 transition-colors hover:bg-white/20 hover:text-white" aria-label="Instagram">
                  <InstagramIcon className="h-4 w-4" />
                </a>
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/25" aria-hidden="true">
                  <InstagramIcon className="h-4 w-4" />
                </span>
              )}
              {socialLinks?.facebook ? (
                <a href={socialLinks.facebook} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-white/60 transition-colors hover:bg-white/20 hover:text-white" aria-label="Facebook">
                  <FacebookIcon className="h-4 w-4" />
                </a>
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/25" aria-hidden="true">
                  <FacebookIcon className="h-4 w-4" />
                </span>
              )}
              {socialLinks?.linkedin ? (
                <a href={socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-white/60 transition-colors hover:bg-white/20 hover:text-white" aria-label="LinkedIn">
                  <LinkedInIcon className="h-4 w-4" />
                </a>
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/25" aria-hidden="true">
                  <LinkedInIcon className="h-4 w-4" />
                </span>
              )}
            </div>
          </div>

          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Services</p>
            <div className="space-y-2.5 text-sm text-white/65">
              {SERVICE_FAMILIES.map((family) => (
                <Link key={family} href={familyFirstSlug[family]} className="block transition-colors hover:text-white">
                  {SERVICE_FAMILY_META[family].label}
                </Link>
              ))}
              <Link href="/services" className="block pt-1 font-medium text-primary-foreground/80 transition-colors hover:text-white">
                View all services -&gt;
              </Link>
            </div>
          </div>

          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Quick Links</p>
            <div className="space-y-2.5 text-sm text-white/65">
              <Link href="/" className="block transition-colors hover:text-white">Home</Link>
              <Link href="/faq" className="block transition-colors hover:text-white">FAQ</Link>
              <Link href="/quote" className="block transition-colors hover:text-white">Instant quote</Link>
              <Link href="/subscriptions" className="block transition-colors hover:text-white">Subscriptions</Link>
              <Link href="/airbnb-hosting" className="block transition-colors hover:text-white">Airbnb hosting support</Link>
              <Link href="/contact" className="block transition-colors hover:text-white">Contact us</Link>
              <Link href="/careers" className="block transition-colors hover:text-white">Careers</Link>
              <Link href="/register" className="block transition-colors hover:text-white">Create account</Link>
              <Link href="/login" className="block transition-colors hover:text-white">Portal login</Link>
              <Link href="/terms" className="block transition-colors hover:text-white">Terms &amp; conditions</Link>
              <Link href="/privacy" className="block transition-colors hover:text-white">Privacy policy</Link>
            </div>
          </div>

          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Get in Touch</p>
            <div className="space-y-3 text-sm">
              <a href={telHref} className="flex items-center gap-2 text-white/65 transition-colors hover:text-white">
                <Phone className="h-3.5 w-3.5 shrink-0 text-primary" />
                {displayPhone}
              </a>
              <a href={`mailto:${displayEmail}`} className="flex items-center gap-2 text-white/65 transition-colors hover:text-white">
                <Mail className="h-3.5 w-3.5 shrink-0 text-primary" />
                {displayEmail}
              </a>
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-white/65 transition-colors hover:text-[#25D366]"
              >
                <WhatsAppIcon className="h-3.5 w-3.5 shrink-0 text-[#25D366]" />
                Chat on WhatsApp -&gt;
              </a>
              <div className="flex items-start gap-2 text-white/65">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{displayLocation}</span>
              </div>
              <p className="pl-5 text-xs text-white/40">Mon-Sat: 7am - 6pm</p>
            </div>
          </div>
        </div>

        <div className="border-t border-white/8">
          <div className={cn(PUBLIC_PAGE_CONTAINER, "flex flex-col items-center justify-between gap-2 py-5 text-xs text-white/35 sm:flex-row")}>
            <span>&copy; {new Date().getFullYear()} {companyName}. All rights reserved.</span>
            <span>Built in Parramatta, NSW</span>
          </div>
        </div>
      </footer>

      {!hideWhatsApp ? (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-6 right-5 z-50 flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_32px_-8px_rgba(37,211,102,0.55)] transition-all duration-300 hover:scale-105 hover:shadow-[0_12px_40px_-8px_rgba(37,211,102,0.65)] animate-bounce-in sm:bottom-6 sm:right-6"
          aria-label="Chat on WhatsApp"
        >
          <WhatsAppIcon className="h-5 w-5 shrink-0" />
          <span className="hidden sm:inline">Chat on WhatsApp</span>
        </a>
      ) : null}

      {showScrollTop ? (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-[4.5rem] right-5 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-white/90 text-foreground shadow-md backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-white sm:bottom-[4.5rem] sm:right-6"
          aria-label="Scroll to top"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
