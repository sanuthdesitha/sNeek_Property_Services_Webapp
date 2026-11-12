import "server-only";
/**
 * The notice for "Ask cleaner to buy" (catalog type urgent_stock.purchase_ask).
 *
 * On the notification pipeline through the shared office sender, addressed by
 * the URGENT_STOCK_PURCHASE_ASK scope (the ask's own cleaner, only while the
 * ask is still ASKED, re-checked at dispatch). Transports are exactly the ones
 * the office chose: "INBOX" is the inbox row alone; "PUSH" adds the phone and
 * browser pushes; "EMAIL" adds an email. States are what the transports said
 * (queued, inbox available, provider accepted ...), never "delivered".
 */
import { db } from "@/lib/db";
import { escapeHtml } from "@/lib/utils/escape-html";
import { sendOfficeNotification, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "@/lib/notifications/type-controls";
import type { CreatedAsk } from "./urgent-stock-ask";

export const PURCHASE_ASK_TYPE_KEY = "urgent_stock.purchase_ask";

/** Pure: the wording the cleaner sees. */
export function purchaseAskBody(ask: Pick<CreatedAsk, "itemName" | "quantity" | "unit" | "propertyName" | "jobNumber" | "note">): string {
  const job = ask.jobNumber ? ` before job ${ask.jobNumber}` : "";
  const note = ask.note ? ` Note from the office: "${ask.note}"` : "";
  return `The office asks if you can buy ${ask.quantity} ${ask.unit} of ${ask.itemName} for ${ask.propertyName}${job}. Open the job to accept or decline. If you accept it goes on your shopping run; keep the receipt — the office approves the reimbursement.${note}`;
}

export async function sendPurchaseAskNotice(actorId: string, ask: CreatedAsk): Promise<RecipientOutcome[]> {
  const controls = await getNotificationTypeControls();
  const cleaner = await db.user.findUnique({ where: { id: ask.cleanerId }, select: { email: true } });
  const body = purchaseAskBody(ask);
  const url = ask.jobId ? `/v2/cleaner/jobs/${ask.jobId}` : "/v2/cleaner/supplies?tab=shopping";
  return sendOfficeNotification({
    typeKey: PURCHASE_ASK_TYPE_KEY,
    eventKey: "urgent_stock.purchase_ask",
    eventId: `urgent-purchase-ask:${ask.id}`,
    entity: { type: "UrgentStockPurchaseAsk", id: ask.id },
    actorId,
    scopeType: "URGENT_STOCK_PURCHASE_ASK",
    scopeId: () => ask.id,
    category: "shopping",
    severity: "ACTION",
    jobId: ask.jobId,
    subject: `Can you buy ${ask.itemName}?`,
    body,
    url,
    email: () => ({ subject: `Can you buy ${ask.itemName} for ${ask.propertyName}?`, html: `<p>${escapeHtml(body)}</p>` }),
    emailKind: "workforce_update",
    transports: ask.transports,
    recipients: [{ id: ask.cleanerId, role: "CLEANER", name: ask.cleanerName, email: cleaner?.email ?? null }],
    respectsPreferences: typeRespectsPreferences(controls, PURCHASE_ASK_TYPE_KEY),
    disabledTransports: controls.disabledTransports[PURCHASE_ASK_TYPE_KEY] ?? [],
  });
}
