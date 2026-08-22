import { redirect } from "next/navigation";

/**
 * The "More" page is gone.
 *
 * Two of its three links were already in the nav. The third, Settings, was
 * reachable ONLY here — so it moved into the nav before this page went, or the
 * only route to it would have vanished with the menu.
 *
 * Two lists of the same portal is how a page ends up with two names, and how
 * somebody learns which is which by opening both. The portal shell has
 * supported grouped section headings all along; nothing had used them.
 *
 * A redirect rather than a deletion: the URL is in browser history and, for
 * some of these portals, on printed induction material. Landing somewhere
 * useful costs nothing; a 404 costs a support message.
 */
export default function V2MaintenanceMoreRedirect() {
  redirect("/v2/maintenance");
}
