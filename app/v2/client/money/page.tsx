import { redirect } from "next/navigation";

/**
 * "Money" and "Finance" were the same page twice.
 *
 * Both read getClientFinanceOverview. This one showed a balance and an invoice
 * list in 160 lines; /v2/client/finance shows all of that plus property service
 * rates, recent billable work and full invoice history in 279. The cut-down
 * version held the nav slot while the better one sat behind the More page,
 * which is the worst way round for a duplicate to be.
 *
 * The nav now says "Money" and points at /finance — one name, the richer page.
 * This route stays as a redirect because clients have it bookmarked.
 */
export default function V2ClientMoneyRedirect() {
  redirect("/v2/client/finance");
}
