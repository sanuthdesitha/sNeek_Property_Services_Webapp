import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listInvoiceContext, listInvoiceFormContext } from "@/lib/billing/client-invoices";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import { listClientInvoices, parseClientInvoiceFilters } from "@/lib/billing/client-invoice-list";
import { getClientInvoiceStats } from "@/lib/billing/client-invoice-stats";
import { getReadyToBill } from "@/lib/billing/ready-to-bill";
import { CLIENT_INVOICE_SORTS } from "@/lib/billing/client-invoice-list-types";
import { z } from "zod";
import { createBlankInvoice } from "@/lib/billing/client-invoice-create";
import { sydneyDayBoundary } from "@/lib/billing/period";
import { can } from "@/lib/rbac/can";

function errorStatus(error: unknown): number {
  if (isListQueryError(error)) return 400;
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN") return 403;
  return 400;
}

/**
 * Three shapes, chosen by query:
 *   ?paginated=1  → { rows, total, page, pageSize, pageCount, sort, dir, counts }
 *                   server paging, sorting and filters (the Estate list).
 *   ?view=context → { clients, properties } for the generator and filters.
 *   ?view=stats   → the four figures above the table (lib/billing/client-invoice-stats).
 *   ?view=ready-to-bill → finished unbilled jobs per client with their charges.
 *   (neither)     → the original { clients, properties, rates, invoices } with
 *                   the newest 100 invoices, kept for the classic admin screen.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const paginated = params.get("paginated");
    if (paginated === "1" || paginated === "true") {
      const query = parseListQuery(params, {
        sortable: CLIENT_INVOICE_SORTS,
        defaultSort: "created",
        defaultDir: "desc",
        defaultPageSize: 25,
        maxPageSize: 100,
      });
      const filters = parseClientInvoiceFilters(params);
      const [payload, canVoidCredit] = await Promise.all([listClientInvoices({ query, filters }), can(session, "invoices.void_credit")]);
      return NextResponse.json({ ...payload, canVoidCredit });
    }
    if (params.get("view") === "stats") {
      return NextResponse.json(await getClientInvoiceStats());
    }
    // Per-client "Ready to bill" for the "Create N drafts" dialog.
    if (params.get("view") === "ready-to-bill") {
      return NextResponse.json(await getReadyToBill());
    }
    if (params.get("view") === "context") {
      return NextResponse.json(await listInvoiceFormContext());
    }
    return NextResponse.json(await listInvoiceContext());
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not load invoices.";
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}

const blankSchema = z.object({
  kind: z.literal("BLANK"),
  clientId: z.string().trim().min(1).max(64),
  periodStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  gstEnabled: z.boolean().optional(),
});

/**
 * POST { kind: "BLANK", clientId, periodStart, periodEnd } → a DRAFT with no
 * lines, numbered from the existing client sequence. The caller opens the
 * editor page with the returned id. Same roles as the generator.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = blankSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose a client and a period (start and end dates)." }, { status: 400 });
    }
    const body = parsed.data;
    const result = await createBlankInvoice(
      {
        clientId: body.clientId,
        periodStart: sydneyDayBoundary(body.periodStart, "start"),
        periodEnd: sydneyDayBoundary(body.periodEnd, "end"),
        gstEnabled: body.gstEnabled,
      },
      session.user,
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not create the invoice.";
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}
