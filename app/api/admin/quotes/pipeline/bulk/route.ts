import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { PATCH as patchLead } from "@/app/api/admin/leads/[id]/route";
import { POST as sendQuote } from "@/app/api/admin/quotes/[id]/send/route";

export const dynamic = "force-dynamic";

const MAX_ROWS = 50;

const bodySchema = z.object({
  action: z.enum(["send", "mark-lost"]),
  rows: z.array(z.object({ kind: z.enum(["lead", "quote"]), id: z.string().min(1).max(64) })).min(1).max(MAX_ROWS),
});

type Outcome = { kind: "lead" | "quote"; id: string; status: "done" | "refused"; message: string };

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}

/**
 * POST /api/admin/quotes/pipeline/bulk { action, rows: [{ kind, id }] }
 *
 * - send: each quote through the existing send route with no recipient
 *   override, so it goes to the quote's client or lead email (refused when
 *   there is none). Leads are refused: a lead needs a quote first.
 * - mark-lost: each lead through the existing lead PATCH (status LOST). A
 *   quote is refused: it is declined by the client, not by the office.
 * Rows run one after another; each reports done or refused with the reason.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `Send an action and 1 to ${MAX_ROWS} rows.` }, { status: 400 });

  const outcomes: Outcome[] = [];
  for (const row of parsed.data.rows) {
    try {
      if (parsed.data.action === "send") {
        if (row.kind !== "quote") {
          outcomes.push({ ...row, status: "refused", message: "A lead has no quote to send yet. Make a quote first." });
          continue;
        }
        const response = await sendQuote(new NextRequest(new URL(`/api/admin/quotes/${row.id}/send`, req.url), { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), { params: { id: row.id } });
        outcomes.push(response.ok ? { ...row, status: "done", message: "Sent." } : { ...row, status: "refused", message: await readError(response, "Could not send.") });
      } else {
        if (row.kind !== "lead") {
          outcomes.push({ ...row, status: "refused", message: "Only leads can be marked lost; a quote is declined by the client." });
          continue;
        }
        const response = await patchLead(new NextRequest(new URL(`/api/admin/leads/${row.id}`, req.url), { method: "PATCH", body: JSON.stringify({ status: "LOST" }), headers: { "content-type": "application/json" } }), { params: { id: row.id } });
        outcomes.push(response.ok ? { ...row, status: "done", message: "Marked lost." } : { ...row, status: "refused", message: await readError(response, "Could not update the lead.") });
      }
    } catch (error) {
      outcomes.push({ ...row, status: "refused", message: error instanceof Error && error.message ? error.message : "Failed." });
    }
  }
  return NextResponse.json({ action: parsed.data.action, outcomes, done: outcomes.filter((row) => row.status === "done").length });
}
