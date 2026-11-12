/**
 * The public site's phone menu (board "Public and sign in" › "Public site menu
 * (☰ on the quote page)"), grouped as drawn. Plain module: read by the public
 * shell and the tests. Every link already exists; the footer keeps its list.
 *
 * "Cleaning in your suburb" is drawn too, but suburb pages exist only per
 * suburb (/v2/cleaning/[suburb]) with no index to link to, so it is not listed.
 */
export interface PublicMenuLink {
  href: string;
  label: string;
}

export const PUBLIC_MENU_GROUPS: readonly (readonly PublicMenuLink[])[] = [
  [
    { href: "/v2/home", label: "Home" },
    { href: "/v2/services", label: "Services" },
    { href: "/v2/airbnb-hosting", label: "Airbnb hosting" },
  ],
  [
    { href: "/v2/subscriptions", label: "Subscriptions" },
    { href: "/v2/compare", label: "Compare" },
    { href: "/v2/why-us", label: "Why us" },
  ],
  [
    { href: "/v2/faq", label: "FAQ" },
    { href: "/v2/blog", label: "Blog" },
    { href: "/v2/careers", label: "Careers" },
    { href: "/v2/contact", label: "Contact" },
  ],
  [
    { href: "/v2/privacy", label: "Privacy" },
    { href: "/v2/terms", label: "Terms" },
  ],
];
