import { redirect } from "next/navigation";

/**
 * The "More" page is gone.
 *
 * It was a second menu: twelve links, SIX of which already sat in the nav under
 * different names, and the other six reachable nowhere else. Two lists of the
 * same portal is how a page ends up with two names, and how a cleaner learns
 * that "Pay", "Pay requests" and "Invoices" are three different screens by
 * opening all three.
 *
 * Everything it linked to now lives in the nav itself, grouped under Work,
 * Money and You — the shell had supported section headings all along and
 * nothing had ever used them.
 *
 * A redirect rather than a deletion, because the URL is in people's history and
 * on at least one printed induction sheet. Sending them to Today costs nothing;
 * a 404 costs a support message.
 */
export default function V2CleanerMoreRedirect() {
  redirect("/v2/cleaner");
}
