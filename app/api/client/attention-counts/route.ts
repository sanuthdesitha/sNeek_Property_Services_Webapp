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
 * FAILURE IS SILENT BY DESIGN — each query degrades to 0, the route answers 200.
 */
export async function GET() {
  try {
    const portal = await requireClientPortal();
    const clientId = portal.clientId;
    const propertyFilter = portal.propertyIds ? { id: { in: portal.propertyIds } } : {};

    const [approvals, cases, quotes, invoices] = await Promise.all([
      // Extra work this client has been asked to approve.
      db.jobTask
        .count({
          where: {
            source: "CLIENT",
            approvalStatus: "PENDING_APPROVAL",
            job: { property: { clientId, ...propertyFilter } },
          },
        })
        .catch(() => 0),
      // Only cases actually waiting on the client — not every open case.
      db.issueTicket
        .count({ where: { clientId, state: CaseState.AWAITING_CLIENT, clientVisible: true } })
        .catch(() => 0),
      // Issued and undecided. DRAFT has not been sent; ACCEPTED/DECLINED are done.
      db.quote.count({ where: { clientId, status: QuoteStatus.SENT } }).catch(() => 0),
      // Payable, matching the portal's own definition of a payable invoice.
      db.clientInvoice
        .count({
          where: {
            clientId,
            status: {
              in: [
                ClientInvoiceStatus.SENT,
                ClientInvoiceStatus.APPROVED,
                ClientInvoiceStatus.PART_PAID,
              ],
            },
          },
        })
        .catch(() => 0),
    ]);

    return NextResponse.json({
      counts: {
        "/v2/client/approvals": approvals,
        "/v2/client/cases": cases,
        "/v2/client/quotes": quotes,
        "/v2/client/money": invoices,
      },
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not load counts." }, { status });
  }
}
