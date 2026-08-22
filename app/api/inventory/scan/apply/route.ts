import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { tallyScans, unitsPerScan } from "@/lib/inventory/barcodes";
import { reconcileCountRun, shoppingNeedsFromCount } from "@/lib/inventory/count-run";
import { notifyScanCountCompleted } from "@/lib/inventory/notifications";

export const runtime = "nodejs";

/**
 * Approve a count run and write it to the stock.
 *
 * THE COUNT IS RECOMPUTED HERE from the raw scans, rather than trusting figures
 * the client worked out. The review screen and this endpoint run the same pure
 * functions over the same input, so what the cleaner approved is what gets
 * written — and a stale or tampered client cannot post a stock level that no
 * scan supports.
 *
 * Manual overrides ARE accepted, because the person at the cupboard can see a
 * bottle the scanner missed. They go into the ledger note, so a figure that
 * came from a human rather than a scan says so permanently.
 *
 * ZEROING NEEDS AN EXPLICIT YES. When the run would set stocked items to zero,
 * the first request comes back 409 with that list; the client shows it, and
 * only a second request carrying `confirmZero` proceeds. A count that silently
 * wipes a shelf because someone stopped scanning halfway is the exact failure
 * this flow exists to prevent.
 */

const bodySchema = z.object({
  propertyId: z.string().trim().min(1),
  scans: z.array(z.string().trim().min(1).max(64)).max(2000),
  overrides: z.record(z.string(), z.number().min(0).max(100_000)).optional(),
  /** Set only after the operator has seen and accepted the zero list. */
  confirmZero: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = bodySchema.parse(await req.json().catch(() => ({})));

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
          id: true,
          itemId: true,
          onHand: true,
          parLevel: true,
          reorderThreshold: true,
          item: { select: { name: true, supplier: true, unit: true, isActive: true } },
        },
      }),
    ]);

    if (stockRows.length === 0) {
      return NextResponse.json(
        { error: "This property has no stock items set up yet." },
        { status: 400 }
      );
    }

    const byCode = new Map(barcodes.map((b) => [b.code, b]));
    const resolved: Array<{ itemId: string; units: number }> = [];
    const unknown: Array<{ code: string; scans: number }> = [];
    for (const tally of tallies) {
      const match = byCode.get(tally.code);
      if (!match) {
        unknown.push(tally);
        continue;
      }
      resolved.push({ itemId: match.itemId, units: tally.scans * unitsPerScan(match.packSize) });
    }

    const active = stockRows.filter((row) => row.item.isActive);
    const reconciliation = reconcileCountRun({
      stockLines: active.map((row) => ({
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

    if (reconciliation.requiresZeroConfirmation && body.confirmZero !== true) {
      // Not an error — a question. The client shows the list and asks.
      return NextResponse.json(
        {
          error: "ZERO_CONFIRMATION_REQUIRED",
          wouldZero: reconciliation.wouldZero,
          message:
            "These items were not scanned and would be set to zero. Are you sure none were missed?",
        },
        { status: 409 }
      );
    }

    const stockByItem = new Map(active.map((row) => [row.itemId, row]));
    const allLines = [...reconciliation.counted, ...reconciliation.wouldZero];
    const overrides = body.overrides ?? {};

    // Only rows that actually move are written. An unchanged shelf should not
    // produce a ledger entry saying it was adjusted to the number it already
    // held — that turns the stock history into noise nobody can read.
    const changed = allLines.filter((line) => line.countedOnHand !== line.previousOnHand);

    await db.$transaction(async (tx) => {
      for (const line of changed) {
        const row = stockByItem.get(line.itemId);
        if (!row) continue;

        await tx.propertyStock.update({
          where: { id: row.id },
          data: { onHand: line.countedOnHand },
        });

        const wasManual = Object.prototype.hasOwnProperty.call(overrides, line.itemId);
        await tx.stockTx.create({
          data: {
            propertyStockId: row.id,
            txType: "ADJUSTED",
            // Signed delta, matching the ledger's convention: positive adds.
            quantity: line.countedOnHand - line.previousOnHand,
            notes: [
              `Stock count${wasManual ? " (counted by hand)" : " (scanned)"}`,
              `${line.previousOnHand} → ${line.countedOnHand}`,
              body.note?.trim() || null,
            ]
              .filter(Boolean)
              .join(" · "),
          },
        });
      }
    });

    // Tell the office. AFTER the transaction and deliberately not awaited
    // into the response: the stock is already written, and a mail server
    // having a bad afternoon must never be the reason a cleaner is told
    // their count failed. Errors are swallowed inside the notifier.
    const [property, counter] = await Promise.all([
      db.property.findUnique({
        where: { id: body.propertyId },
        select: { name: true, suburb: true },
      }),
      db.user.findUnique({ where: { id: session.user.id }, select: { name: true } }),
    ]);

    void notifyScanCountCompleted({
      propertyId: body.propertyId,
      propertyLabel: [property?.name, property?.suburb].filter(Boolean).join(" · ") ||
        "A property",
      countedByLabel: counter?.name?.trim() || "A team member",
      changedCount: changed.length,
      zeroedCount: reconciliation.wouldZero.length,
    }).catch(() => undefined);

    return NextResponse.json({
      applied: changed.length,
      zeroed: reconciliation.wouldZero.length,
      unknown: reconciliation.unknown,
      rejected,
      // What to buy, ready for the shopping list.
      shoppingNeeds: shoppingNeedsFromCount(reconciliation),
      countedBy: session.user.id,
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not apply that count." }, { status });
  }
}
