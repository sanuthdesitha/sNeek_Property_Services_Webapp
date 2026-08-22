import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { normalizeBarcode, unitsPerScan } from "@/lib/inventory/barcodes";
import { normalizeLabelCode } from "@/lib/inventory/label-codes";
import {
  applyQuickScan,
  quickScanNote,
  QUICK_SCAN_MODES,
  QUICK_SCAN_ERROR_MESSAGE,
  type QuickScanMode,
} from "@/lib/inventory/quick-scan";

export const runtime = "nodejs";

/**
 * One scan, one adjustment.
 *
 * Unlike the count run, this touches ONLY the item scanned. Everything else on
 * the shelf is left exactly as it was, which is the promise that makes the tool
 * safe to hand a cleaner in the middle of a job.
 *
 * A scan is resolved in two passes, because two kinds of barcode can arrive:
 * one of OUR printed labels (SNK-…, possibly pinned to a property), or the
 * manufacturer's code off the packaging. Labels are checked first — they are
 * unambiguous, and a pinned label tells us where the stock is without the
 * client having to be right about it.
 */

const bodySchema = z.object({
  code: z.string().trim().min(1).max(64),
  propertyId: z.string().trim().min(1),
  mode: z.enum(QUICK_SCAN_MODES as [QuickScanMode, ...QuickScanMode[]]),
  /** SET: the new figure. TRANSFER: how many to move. */
  quantity: z.number().min(0).max(100_000).optional(),
  /** TRANSFER only. */
  toPropertyId: z.string().trim().min(1).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    // OUR label first. It is exact, and it can carry the property.
    const labelCode = normalizeLabelCode(body.code);
    const productCode = labelCode ? null : normalizeBarcode(body.code);

    if (!labelCode && productCode?.kind === "INVALID") {
      return NextResponse.json(
        { error: "That did not scan cleanly. Try again, or type the code." },
        { status: 400 }
      );
    }

    const barcode = await db.itemBarcode.findUnique({
      where: { code: labelCode ?? (productCode?.code as string) },
      select: {
        itemId: true,
        packSize: true,
        kind: true,
        propertyId: true,
        item: { select: { name: true, unit: true, isActive: true } },
      },
    });

    if (!barcode || !barcode.item.isActive) {
      return NextResponse.json(
        {
          error: "NOT_REGISTERED",
          code: labelCode ?? productCode?.code,
          message: "That barcode is not registered yet.",
        },
        { status: 404 }
      );
    }

    // A label pinned to a property wins over whatever screen the cleaner had
    // open: the printed tag is physically attached to that cupboard, and it is
    // better evidence of where the stock is than a dropdown left on a previous
    // selection.
    const propertyId = barcode.propertyId ?? body.propertyId;

    const stock = await db.propertyStock.findUnique({
      where: { propertyId_itemId: { propertyId, itemId: barcode.itemId } },
      select: { id: true, onHand: true, parLevel: true },
    });

    if (!stock) {
      return NextResponse.json(
        {
          error: "NOT_STOCKED_HERE",
          itemName: barcode.item.name,
          message: `${barcode.item.name} is not on this property's stock list.`,
        },
        { status: 404 }
      );
    }

    const outcome = applyQuickScan({
      mode: body.mode,
      currentOnHand: stock.onHand,
      step: unitsPerScan(barcode.packSize),
      quantity: body.quantity ?? null,
      fromPropertyId: propertyId,
      toPropertyId: body.toPropertyId ?? null,
    });

    if (outcome.error) {
      return NextResponse.json(
        { error: outcome.error, message: QUICK_SCAN_ERROR_MESSAGE[outcome.error] },
        { status: 409 }
      );
    }

    // SHOW, or a change amounting to nothing. Answer without writing — a ledger
    // full of rows recording that nothing happened is one nobody can read the
    // real events out of.
    if (outcome.noop) {
      return NextResponse.json({
        itemName: barcode.item.name,
        unit: barcode.item.unit,
        onHand: outcome.nextOnHand,
        parLevel: stock.parLevel,
        changed: false,
      });
    }

    let toPropertyName: string | null = null;

    await db.$transaction(async (tx) => {
      await tx.propertyStock.update({
        where: { id: stock.id },
        data: { onHand: outcome.nextOnHand },
      });

      // TRANSFER is two writes in ONE transaction. Recording the ends
      // separately would leave a window where the stock exists in neither
      // place, and any report run inside it would be wrong.
      if (body.mode === "TRANSFER" && body.toPropertyId) {
        const destination = await tx.propertyStock.findUnique({
          where: {
            propertyId_itemId: { propertyId: body.toPropertyId, itemId: barcode.itemId },
          },
          select: { id: true, onHand: true },
        });
        const moved = Math.abs(outcome.delta);

        let destinationStockId = destination?.id;
        if (destination) {
          await tx.propertyStock.update({
            where: { id: destination.id },
            data: { onHand: destination.onHand + moved },
          });
        } else {
          // The destination does not stock this item yet. Creating the row is
          // right: the stock is physically going there, and refusing would
          // strand it in neither property.
          const created = await tx.propertyStock.create({
            data: {
              propertyId: body.toPropertyId,
              itemId: barcode.itemId,
              onHand: moved,
            },
            select: { id: true },
          });
          destinationStockId = created.id;
        }

        const destProperty = await tx.property.findUnique({
          where: { id: body.toPropertyId },
          select: { name: true },
        });
        toPropertyName = destProperty?.name ?? null;

        if (destinationStockId) {
          await tx.stockTx.create({
            data: {
              propertyStockId: destinationStockId,
              txType: "ADJUSTED",
              quantity: moved,
              notes: "Quick scan · Moved in from another property",
            },
          });
        }
      }

      await tx.stockTx.create({
        data: {
          propertyStockId: stock.id,
          txType: "ADJUSTED",
          quantity: outcome.delta,
          notes: quickScanNote({
            mode: body.mode,
            previous: stock.onHand,
            next: outcome.nextOnHand,
            toPropertyName,
          }),
        },
      });
    });

    return NextResponse.json({
      itemName: barcode.item.name,
      unit: barcode.item.unit,
      onHand: outcome.nextOnHand,
      previousOnHand: stock.onHand,
      parLevel: stock.parLevel,
      delta: outcome.delta,
      changed: true,
      scannedBy: session.user.id,
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not apply that scan." }, { status });
  }
}
