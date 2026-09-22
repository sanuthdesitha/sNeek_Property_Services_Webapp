import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getClientPurchases } from "./client-purchases";
import { canDeliverNotification } from "@/lib/notifications/preferences";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { escapeHtml } from "@/lib/utils/escape-html";
import { resolveAppUrl } from "@/lib/app-url";

/** One durable attempt per submitted run/recipient. Uncertain attempts are never blindly resent. */
export async function notifyClientsShoppingCompleted(runId: string, options: { deliveryId?: string; deliveryIds?: string[]; batchId?: string } = {}) {
  const run = await db.shoppingRun.findUnique({ where: { id: runId }, select: { submittedAt: true, lines: { where: { status: "PURCHASED", purchasedQty: { gt: 0 } }, select: { property: { select: { clientId: true } } } } } });
  if (!run?.submittedAt) return { sent: 0, skipped: 0, unconfirmed: 0 };
  let deliveryClientId: string | null = null;
  if (options.deliveryId) {
    const delivery = await db.heldStockDelivery.findUnique({ where: { id: options.deliveryId }, select: { property: { select: { clientId: true } }, heldStock: { select: { shoppingRunLine: { select: { shoppingRunId: true } } } } } });
    if (delivery?.heldStock.shoppingRunLine?.shoppingRunId !== runId || !delivery.property.clientId) return { sent: 0, skipped: 0, unconfirmed: 0 };
    deliveryClientId = delivery.property.clientId;
  }
  let batchClientId: string | null = null;
  if (options.deliveryIds || options.batchId) {
    if (!options.batchId || !/^held_batch_[a-f0-9]{64}$/.test(options.batchId) || !options.deliveryIds?.length || options.deliveryIds.length > 100 || options.deliveryId) throw new Error("Invalid delivery batch.");
    const selected = Array.from(new Set(options.deliveryIds));
    const deliveries = await db.heldStockDelivery.findMany({ where: { id: { in: selected }, heldStock: { shoppingRunLine: { shoppingRunId: runId } } }, select: { id: true, property: { select: { clientId: true } } } });
    const clients = Array.from(new Set(deliveries.map(row => row.property.clientId)));
    if (deliveries.length !== selected.length || clients.length !== 1 || !clients[0]) throw new Error("Delivery batch scope changed.");
    batchClientId = clients[0];
  }
  const clientIds = batchClientId ? [batchClientId] : deliveryClientId ? [deliveryClientId] : Array.from(new Set(run.lines.flatMap(line => line.property?.clientId ? [line.property.clientId] : [])));
  const availableRecipients = await db.user.findMany({ where: { clientId: { in: clientIds }, role: "CLIENT", isActive: true }, select: { id: true, email: true, clientId: true }, orderBy: { id: "asc" } });
  const recipients = availableRecipients;
  const results = { sent: 0, skipped: 0, unconfirmed: 0 };
  for (const recipient of recipients) {
    try {
      if (!recipient.clientId || !recipient.email || !await canDeliverNotification({ userId: recipient.id, category: "shopping", channel: "EMAIL", role: "CLIENT" })) { results.skipped++; continue; }
      const purchase = (await getClientPurchases(recipient.clientId, { runId, ...(options.deliveryIds ? { deliveryIds: options.deliveryIds } : {}) })).runs[0];
      if (!purchase) { results.skipped++; continue; }
      const subject = options.deliveryId || options.batchId ? "Shopping supplies delivered to your property" : "Shopping completed for your properties";
      const body = `Purchases have been logged for your properties. View item quantities, recorded costs and available receipts in your client portal. Purchase costs are not an invoice or payment request.`;
      const id = `shopping_client_${createHash("sha256").update(JSON.stringify([runId, options.batchId ?? options.deliveryId ?? "completed", recipient.id])).digest("hex")}`;
      const claim = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const existing = await tx.notification.findUnique({ where: { id }, select: { status: true } });
        if (existing) return existing.status === "SENT" ? "sent" : "unconfirmed";
        await tx.notification.create({ data: { id, userId: recipient.id, channel: "EMAIL", subject, body, status: "PENDING", errorMsg: "Delivery attempt claimed; acceptance not yet confirmed." } });
        return "claimed";
      });
      if (claim !== "claimed") { results[claim]++; continue; }
      const rows = purchase.lines.slice(0, 100).map(line => `<tr><td>${escapeHtml(line.itemName)}</td><td>${line.qty} ${escapeHtml(line.unit)}</td><td>${escapeHtml(line.property)}</td><td>${line.lineCost == null ? "Not recorded" : `$${line.lineCost.toFixed(2)}`}</td></tr>`).join("");
      const time = purchase.shoppingTime?.requestedMinutes;
      const approved = purchase.billing?.filter(charge => charge.status === "APPROVED") ?? [];
      const breakdown = approved.map(charge => `<p>${escapeHtml(charge.property)}: approved expense $${charge.expenseAmount?.toFixed(2)}, shopping service ${charge.shoppingMinutes} minutes at ${charge.hourlyRate == null ? "no rate recorded" : `$${charge.hourlyRate.toFixed(2)}/hour`}, labour $${charge.labourAmount?.toFixed(2)}. ${charge.invoice ? `Invoice ${escapeHtml(charge.invoice.number)}: ${escapeHtml(charge.invoice.status)}` : "Not yet invoiced"}.</p>`).join("");
      const receiptLinks = purchase.receipts.filter(receipt => receipt.url && /^https:\/\//i.test(receipt.url)).map(receipt => `<li><a href="${escapeHtml(receipt.url!)}">${escapeHtml(receipt.name)}</a></li>`).join("");
      const summary = `<p>Submitted ${escapeHtml(new Date(purchase.date).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" }))}. Shopper: ${escapeHtml(purchase.shopper)}. ${purchase.totalComplete ? "Recorded purchase total" : "Known recorded costs"}: $${purchase.total.toFixed(2)}.</p>`;
      const html = `<p>${escapeHtml(body)}</p>${summary}${breakdown}${receiptLinks ? `<h3>Receipts</h3><ul>${receiptLinks}</ul><p>Receipt links expire; the portal provides fresh links.</p>` : ""}<table><thead><tr><th>Item</th><th>Quantity</th><th>Property</th><th>Recorded cost</th></tr></thead><tbody>${rows}</tbody></table>${purchase.lines.length > 100 ? "<p>More items are available in the portal.</p>" : ""}${time != null ? `<p>Shopping time logged: ${time} minutes. Approval: ${escapeHtml(purchase.shoppingTime!.approvalStatus)}. This is not an approved client labour charge.</p>` : ""}${purchase.sharedRun ? "<p>Only your property items are shown. Shared receipts and whole-run time are withheld.</p>" : ""}<p><a href="${escapeHtml(resolveAppUrl("/v2/client/shopping?tab=purchases"))}">View purchases and receipts</a></p>`;
      const delivery = await sendEmailDetailed({ kind: "inventory_update", to: recipient.email, subject, html });
      await db.notification.update({ where: { id }, data: delivery.ok ? { status: "SENT", sentAt: new Date(), errorMsg: null } : { status: "FAILED", errorMsg: delivery.skipped ? "Delivery skipped by email settings." : delivery.acceptance === "UNKNOWN" ? "Delivery acceptance unknown; review before resending." : "Email delivery was not confirmed." } });
      if (delivery.ok) results.sent++; else if (delivery.skipped) results.skipped++; else results.unconfirmed++;
    } catch { results.unconfirmed++; }
  }
  return results;
}

/** Called only after the delivery transaction commits; replay uses the same durable batch claim. */
export async function notifyHeldStockDeliveries(batchId: string, results: { id: string; deliveryId: string }[]) {
  if (!/^held_batch_[a-f0-9]{64}$/.test(batchId) || !results.length || results.length > 100 || new Set(results.map(row => row.deliveryId)).size !== results.length) throw new Error("Invalid delivery batch.");
  const deliveries = await db.heldStockDelivery.findMany({ where: { id: { in: results.map(row => row.deliveryId) } }, select: { id: true, heldStockId: true, property: { select: { clientId: true } }, heldStock: { select: { shoppingRunLine: { select: { shoppingRunId: true } } } } } });
  if (deliveries.length !== results.length || deliveries.some(row => !results.some(result => result.deliveryId === row.id && result.id === row.heldStockId))) throw new Error("Delivery batch scope changed.");
  const groups = new Map<string, { runId: string; deliveryIds: string[] }>();
  for (const delivery of deliveries) {
    const runId = delivery.heldStock.shoppingRunLine?.shoppingRunId;
    const clientId = delivery.property.clientId;
    // Old/non-shopping held stock has no submitted purchase source to notify.
    if (!runId || !clientId) continue;
    const key = JSON.stringify([runId, clientId]);
    const group = groups.get(key) ?? { runId, deliveryIds: [] };
    group.deliveryIds.push(delivery.id); groups.set(key, group);
  }
  const total = { sent: 0, skipped: 0, unconfirmed: 0 };
  for (const group of Array.from(groups.values())) {
    try {
      const result = await notifyClientsShoppingCompleted(group.runId, { batchId, deliveryIds: group.deliveryIds.sort() });
      total.sent += result.sent; total.skipped += result.skipped; total.unconfirmed += result.unconfirmed;
    } catch { total.unconfirmed++; }
  }
  return total;
}
