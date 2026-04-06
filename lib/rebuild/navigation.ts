export type RebuildNavItem = {
  href: string;
  label: string;
  pageKey?: string;
};

export const PUBLIC_SITE_NAV: RebuildNavItem[] = [
  { href: "/", label: "Home", pageKey: "home" },
  { href: "/services", label: "Services", pageKey: "services" },
  { href: "/why-us", label: "Why Us", pageKey: "whyUs" },
  { href: "/airbnb-hosting", label: "Airbnb Hosting", pageKey: "airbnbHosting" },
  { href: "/subscriptions", label: "Subscriptions", pageKey: "subscriptions" },
  { href: "/compare", label: "Compare Services", pageKey: "compareServices" },
  { href: "/blog", label: "Blog", pageKey: "blog" },
  { href: "/careers", label: "Careers", pageKey: "careers" },
  { href: "/faq", label: "FAQ", pageKey: "faq" },
  { href: "/contact", label: "Contact", pageKey: "contact" },
  { href: "/quote", label: "Instant Quote", pageKey: "quote" },
  { href: "/login", label: "Login" },
];
