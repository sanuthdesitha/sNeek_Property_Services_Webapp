import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { listSupplierCatalog } from "@/lib/inventory/suppliers";
import { getStockForecast } from "@/lib/phase3/stock-forecast";

const schema = z.object({
  supplier: z.string().trim().min(1),
  to: z.string().trim().email().optional(),
  lookbackDays: z.number().int().min(7).max(180).optional(),
  branchId: z.string().trim().optional().nullable(),
  subject: z.string().trim().max(200).optional(),
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const [forecast, suppliers, settings] = await Promise.all([
      getStockForecast({
        lookbackDays: body.lookbackDays ?? 30,
        branchId: body.branchId ?? null,
      }),
      listSupplierCatalog(),
      getAppSettings(),
    ]);
    const supplier = suppliers.find(
      (item) => item.name.toLowerCase() === body.supplier.toLowerCase()
    );
    const recipient = body.to?.trim() || supplier?.email || null;
    if (!recipient) {
      return NextResponse.json(
        { error: "No recipient email available for this supplier." },
        { status: 400 }
      );
    }

    const group = forecast.bySupplier.find(
      (item) => item.supplier.toLowerCase() === body.supplier.toLowerCase()
    );
    if (!group || group.items.length === 0) {
      return NextResponse.json(
        { error: "No suggested order items found for this supplier." },
        { status: 404 }
      );
    }

    const subject =
      body.subject?.trim() ||
      `${settings.companyName} - Suggested Order (${group.supplier})`;
    const linesHtml = group.items
      .map((item) => {
        const est = item.estimatedCost != null ? `$${item.estimatedCost.toFixed(2)}` : "-";
        return `<tr>
          <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.propertyName)} (${escapeHtml(item.suburb)})</td>
          <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.itemName)}</td>
          <td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">${item.qty}</td>
          <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.unit)}</td>
          <td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">${est}</td>
          <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${item.risk}</td>
        </tr>`;
      })
      .join("");

    const html = `
      <div style="font-family:Arial,sans-serif;color:#111;">
        <h2>${escapeHtml(settings.companyName)} Suggested Order</h2>
        <p><strong>Supplier:</strong> ${escapeHtml(group.supplier)}</p>
        <p><strong>Forecast lookback:</strong> ${forecast.lookbackDays} day(s)</p>
        <p><strong>Estimated total:</strong> $${group.estimatedTotalCost.toFixed(2)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:10px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px;border-bottom:2px solid #d1d5db;">Property</th>
              <th style="text-align:left;padding:6px;border-bottom:2px solid #d1d5db;">Item</th>
              <th style="text-align:right;padding:6px;border-bottom:2px solid #d1d5db;">Qty</th>
              <th style="text-align:left;padding:6px;border-bottom:2px solid #d1d5db;">Unit</th>
              <th style="text-align:right;padding:6px;border-bottom:2px solid #d1d5db;">Est. Cost</th>
              <th style="text-align:left;padding:6px;border-bottom:2px solid #d1d5db;">Risk</th>
            </tr>
          </thead>
          <tbody>${linesHtml}</tbody>
        </table>
      </div>
    `;

    const sent = await sendEmailDetailed({
      to: recipient,
      subject,
      html,
    });
    await db.notification.create({
      data: {
        userId: session.user.id,
        channel: NotificationChannel.EMAIL,
        subject,
        body: `Supplier forecast order sent to ${recipient} (${group.supplier})`,
        status: sent.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: sent.ok ? new Date() : undefined,
        errorMsg: sent.ok ? undefined : sent.error ?? "Email provider failed.",
      },
    });

    if (!sent.ok) {
      return NextResponse.json({ error: sent.error ?? "Could not send supplier email." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sentTo: recipient, supplier: group.supplier });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not email supplier order." }, { status });
  }
}

