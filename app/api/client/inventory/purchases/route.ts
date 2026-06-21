import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { db } from "@/lib/db";
import { getPresignedDownloadUrl } from "@/lib/s3";

const PAYMENT_LABELS: Record<string, string> = {
  COMPANY_CARD: "Company card",
  CLIENT_CARD: "Client card",
  CLEANER_CARD: "Cleaner card",
  ADMIN_CARD: "Admin card",
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};

/**
 * Read-only feed of purchases made for the client's properties — by anyone
 * (cleaner / admin / the client themselves) — with receipts and the payment
 * method, so the client can see what was bought on their behalf and how it was
 * paid for.
 */
export async function GET() {
  try {
    const session = await requireRole([Role.CLIENT]);
    const settings = await getAppSettings();
    if (!isClientModuleEnabled(settings, "shopping")) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    const user = await db.user.findUnique({ where: { id: session.user.id }, select: { clientId: true } });
    const clientId = user?.clientId;
    if (!clientId) return NextResponse.json({ runs: [] });

    const runs = await db.shoppingRun.findMany({
      where: { lines: { some: { property: { clientId }, purchasedQty: { gt: 0 } } } },
      select: {
        id: true,
        title: true,
        createdAt: true,
        submittedAt: true,
        closedAt: true,
        owner: { select: { name: true } },
        receipts: {
          select: { s3Key: true, fileName: true, mimeType: true, amount: true },
          orderBy: { createdAt: "asc" },
        },
        settlements: { select: { paymentMethod: true }, take: 1 },
        lines: {
          where: { property: { clientId }, purchasedQty: { gt: 0 } },
          select: {
            itemName: true,
            purchasedQty: true,
            unit: true,
            lineCost: true,
            property: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const result = await Promise.all(
      runs.map(async (run) => ({
        id: run.id,
        title: run.title,
        date: (run.closedAt ?? run.submittedAt ?? run.createdAt).toISOString(),
        shopper: run.owner?.name ?? "Team",
        paymentMethod: run.settlements[0]
          ? PAYMENT_LABELS[run.settlements[0].paymentMethod] ?? run.settlements[0].paymentMethod
          : null,
        total: run.lines.reduce((sum, l) => sum + (l.lineCost ?? 0), 0),
        lines: run.lines.map((l) => ({
          itemName: l.itemName,
          qty: l.purchasedQty,
          unit: l.unit,
          property: l.property?.name ?? "",
          lineCost: l.lineCost ?? null,
        })),
        receipts: await Promise.all(
          run.receipts.map(async (r) => ({
            url: await getPresignedDownloadUrl(r.s3Key).catch(() => null),
            name: r.fileName,
            mimeType: r.mimeType,
            amount: r.amount,
          }))
        ),
      }))
    );

    return NextResponse.json({ runs: result });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
