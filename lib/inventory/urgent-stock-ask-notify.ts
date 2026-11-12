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
import { defaultNotificationWording, loadNotificationWording, type WordingRenderer } from "@/lib/notifications/wording/render";
import { sendOfficeNotification, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "@/lib/notifications/type-controls";
import type { CreatedAsk } from "./urgent-stock-ask";

export const PURCHASE_ASK_TYPE_KEY = "urgent_stock.purchase_ask";

/** Pure: the wording the cleaner sees. */
type AskWordingInput = Pick<CreatedAsk, "itemName" | "quantity" | "unit" | "propertyName" | "jobNumber" | "note">;

function purchaseAskInbox(ask: AskWordingInput, wording: WordingRenderer) {
  return wording.render("cleaner", "INBOX", {
    itemName: ask.itemName,
    quantity: ask.quantity,
    unit: ask.unit,
    propertyName: ask.propertyName,
    beforeJob: wording.line("job-line", "INBOX", { jobNumber: ask.jobNumber }, Boolean(ask.jobNumber)),
    officeNote: wording.line("note-line", "INBOX", { note: ask.note }, Boolean(ask.note)),
  });
}

/** The ask's inbox wording (pass the loaded wording; the default is used otherwise). */
export function purchaseAskBody(ask: AskWordingInput, wording: WordingRenderer = defaultNotificationWording(PURCHASE_ASK_TYPE_KEY)): string {
  return purchaseAskInbox(ask, wording).body;
}

export async function sendPurchaseAskNotice(actorId: string, ask: CreatedAsk): Promise<RecipientOutcome[]> {
  const controls = await getNotificationTypeControls();
  const cleaner = await db.user.findUnique({ where: { id: ask.cleanerId }, select: { email: true } });
  const wording = await loadNotificationWording(PURCHASE_ASK_TYPE_KEY);
  const inbox = purchaseAskInbox(ask, wording);
  const body = inbox.body;
  const email = wording.render("cleaner", "EMAIL", { itemName: ask.itemName, propertyName: ask.propertyName, messageText: body });
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
    subject: inbox.title,
    body,
    url,
    email: () => ({ subject: email.subject, html: email.html }),
    emailKind: "workforce_update",
    transports: ask.transports,
    recipients: [{ id: ask.cleanerId, role: "CLEANER", name: ask.cleanerName, email: cleaner?.email ?? null }],
    respectsPreferences: typeRespectsPreferences(controls, PURCHASE_ASK_TYPE_KEY),
    disabledTransports: controls.disabledTransports[PURCHASE_ASK_TYPE_KEY] ?? [],
  });
}
