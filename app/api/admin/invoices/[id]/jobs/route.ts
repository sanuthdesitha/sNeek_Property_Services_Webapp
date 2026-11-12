import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { FALLBACK_INVOICE_TIMEZONE } from "@/lib/billing/invoice-due";
import { addJobsSchema, addJobsToInvoice, listUnbilledJobsForInvoice } from "@/lib/billing/client-invoice-add-jobs";

function authStatus(message: string): number {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN") return 403;
  return 400;
}

/** GET → the draft client's finished, unbilled jobs with the charge the generator would bill. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();
    const payload = await listUnbilledJobsForInvoice(params.id, settings.timezone || FALLBACK_INVOICE_TIMEZONE);
    if (!payload) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    return NextResponse.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not load the jobs.";
    return NextResponse.json({ error: message }, { status: authStatus(message) });
  }
}

/** POST { jobIds, expectedUpdatedAt? } → the jobs as lines on this draft (the generator's line builder). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = addJobsSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose the jobs to add." }, { status: 400 });
    }
    const result = await addJobsToInvoice({
      invoiceId: params.id,
      jobIds: parsed.data.jobIds,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      actor: session.user,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not add the jobs.";
    return NextResponse.json({ error: message }, { status: authStatus(message) });
  }
}
