import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { tallyScans, unitsPerScan } from "@/lib/inventory/barcodes";
import { reconcileCountRun, shoppingNeedsFromCount } from "@/lib/inventory/count-run";

export const runtime = "nodejs";

/**
 * Turn a session of raw scans into the count a person can review.
 *
 * WRITES NOTHING. This is the summary screen's data, not the count itself — the
 * cleaner has to see what the scanner made of the cupboard, correct it, and
 * approve before any stock figure moves. Applying on scan would let a mis-scan
 * silently rewrite the shelf with no chance to catch it.
 *
 * The reply carries three lists that must stay distinct:
 *
 *   counted    what was found, with the variance against what we believed.
 *   wouldZero  stocked items nobody scanned. Approving sets these to zero, so
 *              they are surfaced as a question, never as a silent consequence.
 *   unknown    barcodes matching no item. Almost always a product we stock but
 *              have never registered — worth offering to add, never worth
 *              guessing at.
 */

const bodySchema = z.object({
  propertyId: z.string().trim().min(1),
  /** Raw scanner output, in the order read. Normalised server-side. */
  scans: z.array(z.string().trim().min(1).max(64)).max(2000),
  /** Manual corrections from the review screen, keyed by item id. */
  overrides: z.record(z.string(), z.number().min(0).max(100_000)).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    // Canonicalise and fold first, so a cupboard holding the same product in
    // two different packagings resolves to one line rather than two.
    const { tallies, rejected } = tallyScans(body.scans);

    const [barcodes, stockRows] = await Promise.all([
      tallies.length > 0
        ? db.itemBarcode.findMany({
            where: { code: { in: tallies.map((t) => t.code) }, isActive: true },
            select: { code: true, itemId: true, packSize: true },
          })
        : Promise.resolve([]),
      db.propertyStock.findMany({
        where: { propertyId: body.propertyId },
        select: {
          itemId: true,
          onHand: true,
          parLevel: true,
          reorderThreshold: true,
          item: { select: { name: true, supplier: true, unit: true, isActive: true } },
        },
      }),
    ]);

    const byCode = new Map(barcodes.map((b) => [b.code, b]));

    const resolved: Array<{ itemId: string; units: number }> = [];
    const unknown: Array<{ code: string; scans: number }> = [];
    for (const tally of tallies) {
      const match = byCode.get(tally.code);
      if (!match) {
        unknown.push(tally);
        continue;
      }
      // Scans multiplied by pack size — a carton is twelve, not one.
      resolved.push({ itemId: match.itemId, units: tally.scans * unitsPerScan(match.packSize) });
    }

    const reconciliation = reconcileCountRun({
      stockLines: stockRows
        // A discontinued product still sitting on the shelf is not something to
        // count back into circulation, and zeroing it is the right outcome.
        .filter((row) => row.item.isActive)
        .map((row) => ({
          itemId: row.itemId,
          itemName: row.item.name,
          onHand: row.onHand,
          parLevel: row.parLevel,
          reorderThreshold: row.reorderThreshold,
          supplier: row.item.supplier,
          unit: row.item.unit,
        })),
      scans: resolved,
      unknown,
      overrides: body.overrides,
    });

    return NextResponse.json({
      ...reconciliation,
      // Rejected reads come back so a cleaner who scanned eleven things and
      // sees ten counted knows which one failed, rather than assuming the
      // system ate it.
      rejected,
      shoppingNeeds: shoppingNeedsFromCount(reconciliation),
      scannedBy: session.user.id,
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not read that scan run." }, { status });
  }
}
