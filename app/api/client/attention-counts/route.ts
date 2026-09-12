import { NextResponse } from "next/server";
import { CaseState, ClientInvoiceStatus, QuoteStatus } from "@prisma/client";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";

/**
 * GET /api/client/attention-counts — nav badges for the client portal.
 *
 * The client nav carried one badge (approvals). Everything else waiting on the
 * client — a case asking them a question, a quote to decide on, an invoice to
 * pay — was invisible until they opened the page.
 *
 * ACCURACY RULE: each count is "waiting on YOU", not "exists". An open case
 * being worked on by our team is not the client's problem; one in
 * AWAITING_CLIENT is. A DRAFT quote or invoice has not been issued and must not
 * appear at all — the same reason draft invoices were removed from their
 * finance list.
 *
 * Jobs, laundry, properties, reports and the rest carry no badge: they are
 * records, not queues, and a number there would just be a row count.
 *
 * Goes through requireClientPortal, so a VA sees their team's client and only
 * within their granted property scope.
 *
 * Query failures return a retriable error so consumers retain their last counts.
 */
export async function GET() {
  try {
    const portal = await requireClientPortal();
    const clientId = portal.clientId;
    const propertyFilter = portal.propertyIds ? { id: { in: portal.propertyIds } } : {};
    const isClient = portal.actor === "CLIENT";
    const canSeeCases = isClient || portal.permissions.maintenance === true;
    const canSeeInvoices = isClient || portal.permissions.invoicesView === true;

    const [approvals, cases, quotes, invoices] = await Promise.all([
      // Extra work this client has been asked to approve.
      isClient ? db.jobTask
        .count({
          where: {
            source: "CLIENT",
            approvalStatus: "PENDING_APPROVAL",
            job: { property: { clientId, ...propertyFilter } },
          },
        }) : undefined,
      // Only cases actually waiting on the client — not every open case.
      canSeeCases ? db.issueTicket.count({
        where: {
          clientId,
          state: CaseState.AWAITING_CLIENT,
          clientVisible: true,
          ...(portal.propertyIds ? { property: { clientId, ...propertyFilter } } : {}),
        },
      }) : undefined,
      // Issued and undecided. DRAFT has not been sent; ACCEPTED/DECLINED are done.
      isClient ? db.quote.count({ where: { clientId, status: QuoteStatus.SENT } }) : undefined,
      // Payable, matching the portal's own definition of a payable invoice.
      canSeeInvoices ? db.clientInvoice
        .count({
          where: {
            clientId,
            // Match client-portal-finance: exclude empty, manual and mixed-scope invoices.
            ...(portal.propertyIds
              ? { lines: { some: {}, every: { job: { property: { clientId, ...propertyFilter } } } } }
              : {}),
            status: {
              in: [
                ClientInvoiceStatus.SENT,
                ClientInvoiceStatus.APPROVED,
                ClientInvoiceStatus.PART_PAID,
              ],
            },
          },
        }) : undefined,
    ]);

    // Only for the assistant banner — a CLIENT already knows whose account
    // they are in, so the lookup is skipped for them entirely.
    const actingForName =
      portal.actor === "VA"
        ? (
            await db.client
              .findUnique({ where: { id: portal.clientId }, select: { name: true } })
          )?.name ?? null
        : null;

    return NextResponse.json({
      // The nav uses this to gate destinations for a VA: what they may see is
      // decided here by the chokepoint, never inferred client-side.
      portal: {
        actor: portal.actor,
        permissions: portal.permissions,
        // An assistant is signed in as themselves but working inside someone
        // else's account. Naming the client and the team in the shell is the
        // difference between a portal and a disguise: a VA who works for three
        // clients otherwise has nothing on screen telling them which account
        // they are about to change.
        actingFor: portal.actor === "VA" ? actingForName : null,
        teamName: portal.team?.name ?? null,
      },
      counts: {
        ...(isClient ? { "/v2/client/approvals": approvals, "/v2/client/quotes": quotes } : {}),
        ...(canSeeCases ? { "/v2/client/cases": cases } : {}),
        // Matches the nav href. On /money the badge simply never appeared.
        ...(canSeeInvoices ? { "/v2/client/finance": invoices } : {}),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 503;
    return NextResponse.json(
      { error: status === 503 ? "Could not load counts." : message },
      { status }
    );
  }
}
