import { redirect } from "next/navigation";

/**
 * The "More" page is gone.
 *
 * Every one of its eight links was ALREADY in the nav. This page was pure second
 * menu: no page reached it and nothing else, it simply listed the rail again.
 *
 * Two lists of the same portal is how a page ends up with two names, and how
 * somebody learns which is which by opening both. The portal shell has
 * supported grouped section headings all along; nothing had used them.
 *
 * A redirect rather than a deletion: the URL is in browser history and, for
 * some of these portals, on printed induction material. Landing somewhere
 * useful costs nothing; a 404 costs a support message.
 */
export default function V2LaundryMoreRedirect() {
  redirect("/v2/laundry");
}
