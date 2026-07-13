import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { DOCUMENT_TYPE_LIST } from "@/lib/notifications/documents";

export const dynamic = "force-dynamic";

/**
 * GET — the resendable documents for this client: the document-type menu plus
 * the targets each type is picked from (quotes, invoices, report-ready jobs).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const client = await db.client.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

    const [quotes, invoices, reports] = await Promise.all([
      db.quote.findMany({
        where: { clientId: params.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, serviceType: true, status: true, totalAmount: true, createdAt: true, publicToken: true },
      }),
      db.clientInvoice.findMany({
        where: { clientId: params.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, invoiceNumber: true, status: true, totalAmount: true, createdAt: true },
      }),
      // Report-ready jobs: this client's jobs that have a stored report.
      db.job.findMany({
        where: { property: { clientId: params.id }, report: { isNot: null } },
        orderBy: { scheduledDate: "desc" },
        take: 30,
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          scheduledDate: true,
          property: { select: { name: true } },
          report: { select: { sentToClient: true } },
        },
      }),
    ]);

    return NextResponse.json(
      {
        documentTypes: DOCUMENT_TYPE_LIST,
        quotes: quotes.map((q) => ({
          id: q.id,
          label: `#${String(q.id).slice(-7).toUpperCase()} · ${String(q.serviceType).replace(/_/g, " ")} · $${Number(q.totalAmount ?? 0).toFixed(0)}`,
          status: q.status,
          hasLink: Boolean(q.publicToken),
        })),
        invoices: invoices.map((i) => ({
          id: i.id,
          label: `${i.invoiceNumber} · $${Number(i.totalAmount ?? 0).toFixed(2)} · ${i.status}`,
          status: i.status,
        })),
        reports: reports.map((j) => ({
          id: j.id,
          label: `#${j.jobNumber ?? String(j.id).slice(-6)} · ${String(j.jobType).replace(/_/g, " ")} · ${j.property?.name ?? ""}`,
          sent: Boolean(j.report?.sentToClient),
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
