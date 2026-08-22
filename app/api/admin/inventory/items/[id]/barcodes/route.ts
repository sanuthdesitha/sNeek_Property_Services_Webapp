import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { normalizeBarcode, BARCODE_REJECTION_MESSAGE } from "@/lib/inventory/barcodes";

/**
 * The barcodes that identify one inventory item.
 *
 * Registration is where canonicalisation has to happen. If a raw scan were
 * stored here and normalised only at lookup time, an item registered from a
 * UPC-A label would never match the same product scanned from an EAN-13 one —
 * and the mismatch would surface as "the scanner does not recognise this",
 * weeks later, with no obvious cause. Both ends go through
 * lib/inventory/barcodes so they cannot disagree.
 */

const createSchema = z.object({
  code: z.string().trim().min(1).max(64),
  /** What the reader reported. Kept for diagnosing a bad read, not trusted. */
  symbology: z.string().trim().max(32).optional(),
  label: z.string().trim().max(120).optional(),
  /** Units per scan — a carton of twelve counts as twelve. */
  packSize: z.number().positive().max(10_000).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const barcodes = await db.itemBarcode.findMany({
      where: { itemId: params.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ barcodes });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not load the barcodes." }, { status });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));

    const item = await db.inventoryItem.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });

    const normalized = normalizeBarcode(body.code);
    if (normalized.kind === "INVALID") {
      return NextResponse.json(
        { error: BARCODE_REJECTION_MESSAGE[normalized.reason ?? "EMPTY"] },
        { status: 400 }
      );
    }

    // A barcode belongs to exactly one product. Re-pointing it silently would
    // make every future scan of that packaging count against the wrong item,
    // and the stock would drift with nothing in the record explaining why.
    const clash = await db.itemBarcode.findUnique({
      where: { code: normalized.code },
      select: { id: true, itemId: true, item: { select: { name: true } } },
    });
    if (clash) {
      return NextResponse.json(
        {
          error:
            clash.itemId === params.id
              ? "That barcode is already on this item."
              : `That barcode is already registered to ${clash.item.name}. Remove it there first.`,
        },
        { status: 409 }
      );
    }

    const barcode = await db.itemBarcode.create({
      data: {
        itemId: params.id,
        code: normalized.code,
        symbology: body.symbology ?? (normalized.kind === "GTIN" ? "GTIN" : "OPAQUE"),
        label: body.label ?? null,
        packSize: body.packSize ?? 1,
        createdById: session.user.id,
      },
    });

    return NextResponse.json({ barcode }, { status: 201 });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not add the barcode." }, { status });
  }
}
