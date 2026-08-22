import { redirect } from "next/navigation";

/**
 * The "More" page is gone.
 *
 * Seventeen links, and all but three already sat in the nav under the same or a
 * near-identical name. The three that did not — Finance, Approvals and the quote
 * request — are now in the nav proper, so nothing is stranded.
 *
 * Two lists of the same portal is how a page ends up with two names, and how
 * somebody learns which is which by opening both. The portal shell has
 * supported grouped section headings all along; nothing had used them.
 *
 * A redirect rather than a deletion: the URL is in browser history and, for
 * some of these portals, on printed induction material. Landing somewhere
 * useful costs nothing; a 404 costs a support message.
 */
export default function V2ClientMoreRedirect() {
  redirect("/v2/client");
}
