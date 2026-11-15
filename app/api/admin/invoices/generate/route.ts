import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { generateClientInvoice } from "@/lib/billing/client-invoices";
import { sydneyDayBoundary } from "@/lib/billing/period";
import { generateRequestSchema, runGenerateRequest } from "@/lib/billing/client-invoice-generate-request";
import { previewClientInvoiceGeneration } from "@/lib/billing/client-invoice-generate-preview";
import { defaultInvoicePeriod } from "@/lib/billing/invoice-period-default";
import { getAppSettings } from "@/lib/settings";

const schema = z.object({
  clientId: z.string().trim().min(1),
  propertyId: z.string().trim().optional().nullable(),
  periodStart: z.string().trim().optional().nullable(),
  periodEnd: z.string().trim().optional().nullable(),
  gstEnabled: z.boolean().optional(),
  // Which date the period is measured against - see InvoicePeriodBasis.
  periodBasis: z.enum(["SERVICE", "SCHEDULED"]).optional(),
});

const headers = { "Cache-Control": "private, no-store" };
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const previewSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  propertyId: z.string().trim().max(200).optional(),
  from: day.optional(),
  to: day.optional(),
  basis: z.enum(["SERVICE", "SCHEDULED"]).default("SCHEDULED"),
  gst: z.enum(["1", "0"]).optional(),
});

function guardStatus(message: string): number {
  return message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
}

/**
 * Read-only views for New invoice → From finished jobs (same roles as the
 * generator; the finance ops pack applies through middleware):
 *   ?view=preview&clientId&propertyId&from&to&basis&gst → what the draft would hold
 *   ?view=period&clientId → the period default
 * Nothing is written.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = Object.fromEntries(new URL(req.url).searchParams.entries());
    if (params.view === "period") {
      const clientId = z.string().trim().min(1).max(200).safeParse(params.clientId);
      if (!clientId.success) return NextResponse.json({ error: "Choose a client." }, { status: 400, headers });
      const settings = await getAppSettings();
      return NextResponse.json(await defaultInvoicePeriod(clientId.data, settings.timezone || "Australia/Sydney"), { headers });
    }
    if (params.view !== "preview") return NextResponse.json({ error: "Unknown view." }, { status: 400, headers });
    const parsed = previewSchema.safeParse(params);
    if (!parsed.success) return NextResponse.json({ error: "Choose a client and a readable period." }, { status: 400, headers });
    const query = parsed.data;
    if (query.from && query.to && query.from > query.to) {
      return NextResponse.json({ error: "The period start must be on or before the period end." }, { status: 400, headers });
    }
    const preview = await previewClientInvoiceGeneration({
      clientId: query.clientId,
      propertyId: query.propertyId || null,
      periodStart: sydneyDayBoundary(query.from ?? null, "start"),
      periodEnd: sydneyDayBoundary(query.to ?? null, "end"),
      gstEnabled: query.gst === undefined ? undefined : query.gst === "1",
      periodBasis: query.basis,
    });
    return NextResponse.json(preview, { headers });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "The preview could not be loaded.";
    const status = message === "Client not found." ? 404 : guardStatus(message);
    return NextResponse.json({ error: message }, { status, headers });
  }
}

/**
 * Create a draft from finished jobs. With `requestKey` (the New invoice
 * panel) the request is idempotent and may leave named unrated jobs off;
 * without it (older callers) it behaves exactly as before.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const raw = await req.json().catch(() => ({}));
    if (raw && typeof raw === "object" && "requestKey" in raw) {
      const parsed = generateRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a client and period." }, { status: 400 });
      }
      const result = await runGenerateRequest({ request: parsed.data, actorId: session.user.id });
      return NextResponse.json(result.body, { status: result.status });
    }
    const body = schema.parse(raw);
    return NextResponse.json(
      await generateClientInvoice({
        clientId: body.clientId,
        propertyId: body.propertyId || null,
        periodStart: sydneyDayBoundary(body.periodStart, "start"),
        periodEnd: sydneyDayBoundary(body.periodEnd, "end"),
        gstEnabled: body.gstEnabled,
        periodBasis: body.periodBasis,
      })
    );
  } catch (err: any) {
    const message: string = err?.message ?? "Could not generate invoice.";
    // Guard failures answer 401/403; everything else keeps the old 400.
    return NextResponse.json({ error: message }, { status: guardStatus(message) });
  }
}
