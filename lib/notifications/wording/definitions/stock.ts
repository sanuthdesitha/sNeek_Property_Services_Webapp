/** Wording for stock.urgent_need and stock.submission_low_stock (office inbox notices). */
import { editable, inbox, line, part } from "./build";

const URGENT_TITLE = "Urgent stock: {{propertyName}} — {{itemName}}";
const URGENT_TAIL = "{{stage}}. Observed count: {{observedCount}}; requested purchase: {{purchaseQuantity}}.";

export const URGENT_NEED_WORDING = editable("stock.urgent_need", [
  inbox("opened", "Need opened", URGENT_TITLE, `Reported need remains open. ${URGENT_TAIL} Review {{reviewPath}}`, { required: ["propertyName", "itemName"], note: "Sent when a need is first reported (inbox only)." }),
  inbox("reminder", "Reminder", URGENT_TITLE, `Unresolved stock reminder. ${URGENT_TAIL} {{deadlineLine}}Review {{reviewPath}}`, { required: ["propertyName", "itemName"], note: "The reminder worker's notice to administrators (inbox only)." }),
  line("deadline-line", "Next clean deadline", "INBOX", "Next clean planning deadline: {{deadline}}. ", "Added to the reminder only when a next clean is planned."),
  line("unknown", "Unknown value word", "INBOX", "unknown", "Shown for {{observedCount}} or {{purchaseQuantity}} when no number was recorded."),
  inbox("form-review", "Form need not raised yet", "Urgent stock from a form needs review", "A job form counted stock below its urgent level, but the urgent need could not be raised yet. The submission is saved and this will be retried; check the property's stock."),
  inbox("count-review", "Form counts not matched", "Stock count from a form needs review", "{{count}} stock count {{answersWord}} on a job form could not be matched to this property's stock, so on-hand was not changed. Review them in Stock → Stock counts → Counts from job forms.", { required: ["count"], note: "{{answersWord}} is \"answer\" or \"answers\"." }),
]);

export const SUBMISSION_LOW_STOCK_WORDING = editable("stock.submission_low_stock", [
  inbox("low-stock", "Low stock item", "Low stock alert", "{{itemName}} is low at this property ({{onHand}} remaining).", { required: ["itemName"], note: "One per low item; also sent as a browser push." }),
  inbox("auto-run", "Shopping run created", "Auto shopping run created", "{{count}} low-stock items were added to an automatically created shopping run.", { required: ["count"] }),
  part("auto-run", "Shopping run created", "EMAIL", { subject: "Auto shopping run created", body: "<p>{{count}} low-stock items were added to an automatically created shopping run.</p>" }, { required: ["count"] }),
  inbox("restock-review", "Restock needs review", "Submission restock needs review", "Restock follow-up could not finish. The submission is saved; office should check its stock and shopping run. Internal reconciliation will retry."),
]);
