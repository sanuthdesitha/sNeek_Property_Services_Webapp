import { NextRequest, NextResponse } from "next/server";
import { QuoteStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";

function csvEscape(value: string) {
  const text = value ?? "";
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseRange(startDate?: string | null, endDate?: string | null) {
  const now = new Date();
  const start = startDate
    ? new Date(`${startDate}T00:00:00.000Z`)
    : new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = endDate ? new Date(`${endDate}T23:59:59.999Z`) : now;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date range.");
  }
  return { start, end };
}

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const { start, end } = parseRange(
      searchParams.get("startDate"),
      searchParams.get("endDate")
    );
    const settings = await getPhase3IntegrationsSettings();
    if (!settings.xero.enabled) {
      return NextResponse.json({ error: "Xero integration is disabled in settings." }, { status: 400 });
    }

    const quotes = await db.quote.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: { in: [QuoteStatus.ACCEPTED, QuoteStatus.CONVERTED] },
      },
      include: {
        client: { select: { name: true, email: true } },
        lead: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 5000,
    });

    const header = [
      "InvoiceNumber",
      "InvoiceDate",
      "DueDate",
      "ContactName",
      "EmailAddress",
      "Description",
      "Quantity",
      "UnitAmount",
      "AccountCode",
      "TaxType",
      "TrackingName1",
      "TrackingOption1",
      "Reference",
    ];
    const lines = [header.join(",")];
    for (const quote of quotes) {
      const contactName = quote.client?.name || quote.lead?.name || "Client";
      const email =
        quote.client?.email || quote.lead?.email || settings.xero.contactFallbackEmail || "";
      const invoiceDate = quote.createdAt.toISOString().slice(0, 10);
      const dueDate = (quote.validUntil ?? quote.createdAt).toISOString().slice(0, 10);
      lines.push(
        [
          csvEscape(`Q-${quote.id.slice(0, 8)}`),
          csvEscape(invoiceDate),
          csvEscape(dueDate),
          csvEscape(contactName),
          csvEscape(email),
          csvEscape(`${String(quote.serviceType).replace(/_/g, " ")} quote`),
          csvEscape("1"),
          csvEscape(Number(quote.totalAmount).toFixed(2)),
          csvEscape(settings.xero.defaultAccountCode || "200"),
          csvEscape("OUTPUT"),
          csvEscape(settings.xero.trackingCategory || "Branch"),
          csvEscape("Default"),
          csvEscape(quote.id),
        ].join(",")
      );
    }
    const csv = lines.join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"xero-export-${start
          .toISOString()
          .slice(0, 10)}-${end.toISOString().slice(0, 10)}.csv\"`,
      },
    });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not export Xero CSV." }, { status });
  }
}

