"use client";

/**
 * ESTATE v2 public site shell — header, footer, WhatsApp FAB, scroll-to-top.
 * All tokens from [data-skin="estate"][data-portal-accent="public"] via estate.css.
 * No dependency on components/ui/* or the v1 PublicSiteShell.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Mail, MapPin, Menu, Phone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MARKETED_SERVICES, SERVICE_FAMILY_META } from "@/lib/marketing/catalog";
import type { ServiceFamily } from "@/lib/marketing/catalog";
import { EButton, EEyebrow, EThread } from "@/components/v2/ui/primitives";

/* ── Brand / contact constants ──────────────────────────────────────────── */
const PHONE_DISPLAY = "+61 451 217 210";
const PHONE_HREF = "tel:+61451217210";
const EMAIL = "info@sneekproservices.com.au";
const WHATSAPP_NUMBER = "61451217210";
const WHATSAPP_HREF = `https://wa.me/${WHATSAPP_NUMBER}`;
const LOCATION = "Parramatta, NSW 2150";

const SERVICE_FAMILIES: ServiceFamily[] = [
  "short_stay",
  "residential",
  "specialty",
  "exterior",
  "commercial",
];

const NAV_LINKS = [
  { href: "/v2/home", label: "Home" },
  { href: "/v2/services", label: "Services", hasDropdown: true },
  { href: "/v2/why-us", label: "Why sNeek" },
  { href: "/v2/airbnb-hosting", label: "Airbnb" },
  { href: "/v2/faq", label: "FAQ" },
  { href: "/v2/contact", label: "Contact" },
];

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
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

export interface EstatePublicShellProps {
  companyName?: string;
  logoUrl?: string | null;
  children: React.ReactNode;
}

export function EstatePublicShell({
  companyName = "sNeek Property Services",
  logoUrl,
  children,
}: EstatePublicShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const hideWhatsApp = pathname === "/v2/quote" || pathname === "/v2/contact";

  useEffect(() => {
    setMobileOpen(false);
    setServicesOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-reveal observer (same pattern as v1 public shell)
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const targets = document.querySelectorAll<HTMLElement>(
      ".e-scroll-reveal:not(.is-visible)"
    );
    if (!targets.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pathname]);

  const initials = companyName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      data-skin="estate"
      data-portal-accent="public"
      className="relative min-h-screen bg-[hsl(var(--e-background))] text-[hsl(var(--e-foreground))]"
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className={cn(
          "sticky top-0 z-50 border-b transition-all duration-300",
          scrolled
            ? "border-[hsl(var(--e-border))] bg-[hsl(var(--e-background)/0.88)] backdrop-blur-xl"
            : "border-transparent bg-[hsl(var(--e-background)/0.6)] backdrop-blur-md"
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          {/* Wordmark */}
          <Link href="/v2/home" className="flex items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`${companyName} logo`}
                className="h-9 w-9 rounded-full border border-[hsl(var(--e-border-gold)/0.5)] bg-white object-cover p-0.5"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--e-border-gold)/0.5)] bg-[hsl(var(--e-gold-soft))]">
                <span className="e-serif text-[0.9375rem] font-[520] text-[hsl(var(--e-gold-ink))]">
                  {initials || "S"}
                </span>
              </div>
            )}
            <span className="e-serif text-[1.15rem] font-[520] hidden sm:block">{companyName}</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((item) => {
              if (item.hasDropdown) {
                const isActive = pathname.startsWith("/v2/services");
                return (
                  <div
                    key={item.href}
                    className="relative"
                    onMouseEnter={() => setServicesOpen(true)}
                    onMouseLeave={() => setServicesOpen(false)}
                  >
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-1 rounded-[var(--e-radius-pill)] px-4 py-2 text-[0.875rem] transition-colors duration-150",
                        isActive
                          ? "text-[hsl(var(--e-primary))]"
                          : "text-[hsl(var(--e-text-secondary))] hover:text-[hsl(var(--e-foreground))]"
                      )}
                    >
                      {item.label}
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 transition-transform duration-150",
                          servicesOpen && "rotate-180"
                        )}
                      />
                    </Link>
                    {servicesOpen && (
                      <div className="absolute left-0 top-full z-50 w-72 pt-2">
                        <div className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-2)]">
                          <div className="p-2 space-y-0.5">
                            {SERVICE_FAMILIES.map((family) => {
                              const meta = SERVICE_FAMILY_META[family];
                              const first = MARKETED_SERVICES.find((s) => s.family === family);
                              return (
                                <Link
                                  key={family}
                                  href={first ? `/v2/services/${first.slug}` : "/v2/services"}
                                  className="flex items-start gap-3 rounded-[var(--e-radius)] px-3 py-2.5 text-[0.8125rem] hover:bg-[hsl(var(--e-primary-soft)/0.5)] transition-colors duration-150"
                                >
                                  <div className="min-w-0">
                                    <p className="font-[550] text-[hsl(var(--e-foreground))]">{meta.label}</p>
                                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] truncate">{meta.description}</p>
                                  </div>
                                </Link>
                              );
                            })}
                            <EThread className="my-1" />
                            <Link
                              href="/v2/services"
                              className="flex items-center gap-1 rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:bg-[hsl(var(--e-gold-soft))] transition-colors duration-150"
                            >
                              View all services →
                            </Link>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-[var(--e-radius-pill)] px-4 py-2 text-[0.875rem] transition-colors duration-150",
                    isActive
                      ? "text-[hsl(var(--e-primary))]"
                      : "text-[hsl(var(--e-text-secondary))] hover:text-[hsl(var(--e-foreground))]"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden items-center gap-2 lg:flex">
            <EButton asChild variant="ghost" size="sm">
              <Link href="/v2/login">Login</Link>
            </EButton>
            <EButton asChild variant="gold" size="sm">
              <Link href="/v2/quote">Get a quote</Link>
            </EButton>
          </div>

          {/* Mobile hamburger */}
          <button
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--e-border))] lg:hidden"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Menu className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 pb-6 pt-4 lg:hidden">
            <div className="mb-4 flex items-center gap-3 rounded-[var(--e-radius)] bg-[hsl(var(--e-gold-soft))] px-4 py-3 text-[0.8125rem]">
              <Phone className="h-3.5 w-3.5 text-[hsl(var(--e-gold-ink))]" />
              <a href={PHONE_HREF} className="font-[550] text-[hsl(var(--e-gold-ink))]">
                {PHONE_DISPLAY}
              </a>
            </div>
            <nav className="space-y-1">
              {NAV_LINKS.map((item) => {
                const isActive = pathname === item.href || (item.hasDropdown && pathname.startsWith("/v2/services"));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "block rounded-[var(--e-radius)] px-4 py-3 text-[0.875rem] font-medium transition-colors",
                      isActive
                        ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                        : "hover:bg-[hsl(var(--e-muted))]"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <EButton asChild variant="outline" size="sm">
                <Link href="/v2/login">Login</Link>
              </EButton>
              <EButton asChild variant="gold" size="sm">
                <Link href="/v2/quote">Get a quote</Link>
              </EButton>
            </div>
            <a
              href={WHATSAPP_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--e-radius)] bg-[#25D366] py-3 text-[0.875rem] font-semibold text-white"
            >
              <WhatsAppIcon className="h-4 w-4" />
              Chat on WhatsApp
            </a>
          </div>
        )}
      </header>

      {/* ── Page content ────────────────────────────────────────────────── */}
      <main className="relative z-10">{children}</main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4 lg:gap-12">
          {/* Brand */}
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={`${companyName} logo`}
                  className="h-10 w-10 rounded-full border border-[hsl(var(--e-gold)/0.3)] bg-white/10 object-cover p-0.5"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[hsl(var(--e-gold)/0.3)] bg-white/10">
                  <span className="e-serif text-[0.9375rem] font-[520] text-[hsl(var(--e-gold))]">
                    {initials || "S"}
                  </span>
                </div>
              )}
              <div>
                <p className="font-semibold text-[hsl(var(--e-primary-foreground))]">{companyName}</p>
                <p className="text-[0.6875rem] text-[hsl(var(--e-primary-foreground)/0.55)]">Property cleaning &amp; hosting support</p>
              </div>
            </div>
            <span className="inline-flex items-center rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-gold)/0.3)] bg-[hsl(var(--e-gold)/0.1)] px-3 py-1.5 text-[0.75rem] font-medium text-[hsl(var(--e-gold))]">
              $5M Public Liability Insured
            </span>
            <div className="flex items-center gap-2">
              <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-[hsl(var(--e-primary-foreground)/0.5)] transition-colors hover:bg-[#25D366] hover:text-white">
                <WhatsAppIcon className="h-4 w-4" />
              </a>
              <a href="https://www.instagram.com/sneekproservices" target="_blank" rel="noopener noreferrer" aria-label="Instagram"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-[hsl(var(--e-primary-foreground)/0.5)] transition-colors hover:bg-white/20 hover:text-white">
                <InstagramIcon className="h-4 w-4" />
              </a>
              <a href="https://www.facebook.com/sneekproservices" target="_blank" rel="noopener noreferrer" aria-label="Facebook"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-[hsl(var(--e-primary-foreground)/0.5)] transition-colors hover:bg-white/20 hover:text-white">
                <FacebookIcon className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Services */}
          <div>
            <EEyebrow className="mb-4 !text-[hsl(var(--e-primary-foreground)/0.4)]">Services</EEyebrow>
            <div className="space-y-2.5 text-[0.875rem] text-[hsl(var(--e-primary-foreground)/0.65)]">
              {SERVICE_FAMILIES.map((family) => {
                const meta = SERVICE_FAMILY_META[family];
                const first = MARKETED_SERVICES.find((s) => s.family === family);
                return (
                  <Link
                    key={family}
                    href={first ? `/v2/services/${first.slug}` : "/v2/services"}
                    className="block transition-colors hover:text-[hsl(var(--e-primary-foreground))]"
                  >
                    {meta.label}
                  </Link>
                );
              })}
              <Link href="/v2/services" className="block pt-1 font-[550] text-[hsl(var(--e-gold))] transition-colors hover:text-[hsl(var(--e-primary-foreground))]">
                View all services →
              </Link>
            </div>
          </div>

          {/* Quick links */}
          <div>
            <EEyebrow className="mb-4 !text-[hsl(var(--e-primary-foreground)/0.4)]">Quick links</EEyebrow>
            <div className="space-y-2.5 text-[0.875rem] text-[hsl(var(--e-primary-foreground)/0.65)]">
              {[
                { href: "/v2/home", label: "Home" },
                { href: "/v2/why-us", label: "Why sNeek" },
                { href: "/v2/airbnb-hosting", label: "Airbnb hosting" },
                { href: "/v2/subscriptions", label: "Subscriptions" },
                { href: "/v2/compare", label: "Compare services" },
                { href: "/v2/blog", label: "Blog" },
                { href: "/v2/careers", label: "Careers" },
                { href: "/v2/faq", label: "FAQ" },
                { href: "/v2/quote", label: "Instant quote" },
                { href: "/v2/login", label: "Portal login" },
                { href: "/v2/terms", label: "Terms" },
                { href: "/v2/privacy", label: "Privacy" },
              ].map((l) => (
                <Link key={l.href} href={l.href} className="block transition-colors hover:text-[hsl(var(--e-primary-foreground))]">
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div>
            <EEyebrow className="mb-4 !text-[hsl(var(--e-primary-foreground)/0.4)]">Get in touch</EEyebrow>
            <div className="space-y-3 text-[0.875rem]">
              <a href={PHONE_HREF} className="flex items-center gap-2 text-[hsl(var(--e-primary-foreground)/0.65)] transition-colors hover:text-[hsl(var(--e-primary-foreground))]">
                <Phone className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-gold))]" />
                {PHONE_DISPLAY}
              </a>
              <a href={`mailto:${EMAIL}`} className="flex items-center gap-2 text-[hsl(var(--e-primary-foreground)/0.65)] transition-colors hover:text-[hsl(var(--e-primary-foreground))]">
                <Mail className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-gold))]" />
                {EMAIL}
              </a>
              <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-[hsl(var(--e-primary-foreground)/0.65)] transition-colors hover:text-[#25D366]">
                <WhatsAppIcon className="h-3.5 w-3.5 shrink-0 text-[#25D366]" />
                Chat on WhatsApp →
              </a>
              <div className="flex items-start gap-2 text-[hsl(var(--e-primary-foreground)/0.65)]">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-gold))]" />
                <span>{LOCATION}</span>
              </div>
              <p className="pl-5 text-[0.75rem] text-[hsl(var(--e-primary-foreground)/0.4)]">Mon–Sat: 7am – 6pm</p>
            </div>
          </div>
        </div>

        <div className="border-t border-[hsl(var(--e-primary-foreground)/0.08)]">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-5 text-[0.75rem] text-[hsl(var(--e-primary-foreground)/0.35)] sm:flex-row">
            <span>&copy; {new Date().getFullYear()} {companyName}. All rights reserved.</span>
            <span>Estate rebrand preview · Built in Parramatta, NSW</span>
          </div>
        </div>
      </footer>

      {/* ── WhatsApp FAB ─────────────────────────────────────────────────── */}
      {!hideWhatsApp && (
        <a
          href={WHATSAPP_HREF}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat on WhatsApp"
          className="fixed bottom-6 right-5 z-50 flex items-center gap-2 rounded-[var(--e-radius-pill)] bg-[#25D366] px-4 py-3 text-[0.875rem] font-semibold text-white shadow-[0_8px_32px_-8px_rgba(37,211,102,0.55)] transition-all duration-200 hover:scale-105 hover:shadow-[0_12px_40px_-8px_rgba(37,211,102,0.65)] sm:right-6"
        >
          <WhatsAppIcon className="h-5 w-5 shrink-0" />
          <span className="hidden sm:inline">Chat on WhatsApp</span>
        </a>
      )}

      {/* ── Scroll to top ────────────────────────────────────────────────── */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-[4.5rem] right-5 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.9)] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)] backdrop-blur-sm transition-all duration-200 hover:scale-110 sm:right-6"
          aria-label="Scroll to top"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
