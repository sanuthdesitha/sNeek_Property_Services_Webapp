import { redirect } from "next/navigation";

/**
 * The "More" page is gone.
 *
 * Invoices, Profile and Stats lived only here. An inspector could not reach their
 * own invoices without going through a menu page first; all three are in the nav
 * now.
 *
 * Two lists of the same portal is how a page ends up with two names, and how
 * somebody learns which is which by opening both. The portal shell has
 * supported grouped section headings all along; nothing had used them.
 *
 * A redirect rather than a deletion: the URL is in browser history and, for
 * some of these portals, on printed induction material. Landing somewhere
 * useful costs nothing; a 404 costs a support message.
 */
export default function V2QaMoreRedirect() {
  redirect("/v2/qa");
}
