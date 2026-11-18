/**
 * POST /api/client/maintenance/handled/:id
 *   { action: "ACCEPT" }
 *   { action: "DECLINE", reason, expectedVersion? }
 *   { action: "SET_TRADESPERSON", tradesperson: { name, phone?, trade?, company?, note?, plannedDate?, startTime?, endTime?, accessMethod? }, expectedVersion? }
 *   { action: "CLEAR_TRADESPERSON", expectedVersion? }
 *   { action: "MARK_DONE", note, photoKeys?, expectedVersion? }
 *   { action: "COULD_NOT_DO", reason, expectedVersion? }
 * → { outcome: "done" | "unchanged", item }
 *
 * Guard: the client-portal chokepoint (CLIENT, or an assistant with the
 * maintenance permission). The item is re-read under its lock inside the
 * caller's CURRENT client and property scope; anything else reads as not found.
 * Photos must have been uploaded by this person (lib/uploads/ownership).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { ClientHandlingError, clientHandlingAct } from "@/lib/maintenance/client-handling";

export const dynamic = "force-dynamic";

const version = z.number().int().min(0).optional();
const tradesperson = z
  .object({
    name: z.string().max(200),
    phone: z.string().max(60).optional(),
    trade: z.string().max(200).optional(),
    company: z.string().max(200).optional(),
    note: z.string().max(2000).optional(),
    plannedDate: z.string().max(10).optional(),
    startTime: z.string().max(5).optional(),
    endTime: z.string().max(5).optional(),
    accessMethod: z.string().max(40).optional(),
  })
  .strict();

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACCEPT"), expectedVersion: version }).strict(),
  z.object({ action: z.literal("DECLINE"), reason: z.string().max(2000), expectedVersion: version }).strict(),
  z.object({ action: z.literal("SET_TRADESPERSON"), tradesperson, expectedVersion: version }).strict(),
  z.object({ action: z.literal("CLEAR_TRADESPERSON"), expectedVersion: version }).strict(),
  z.object({ action: z.literal("MARK_DONE"), note: z.string().max(2000), photoKeys: z.array(z.string().max(1000)).max(20).optional(), expectedVersion: version }).strict(),
  z.object({ action: z.literal("COULD_NOT_DO"), reason: z.string().max(2000), expectedVersion: version }).strict(),
]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const portal = await requireClientPortal({ permission: "maintenance" });
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const result = await clientHandlingAct(portal, {
      itemId: params.id,
      action: body.action,
      expectedVersion: body.expectedVersion,
      reason: "reason" in body ? body.reason : null,
      note: "note" in body ? body.note : null,
      tradesperson: "tradesperson" in body ? body.tradesperson : undefined,
      photoKeys: "photoKeys" in body ? body.photoKeys : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ClientHandlingError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError) return NextResponse.json({ error: "That request was not understood. Reload the page and try again." }, { status: 400 });
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    if (message === "FORBIDDEN") return NextResponse.json({ error: "You do not have access to this." }, { status: 403 });
    return NextResponse.json({ error: "That could not be saved. Your entry is kept; try again." }, { status: 500 });
  }
}
