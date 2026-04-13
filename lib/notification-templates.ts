import { resolveAppUrl } from "@/lib/app-url";

export type AppNotificationTemplateKey =
  | "newProfileCreated"
  | "jobAssigned"
  | "jobRemoved"
  | "jobUpdated"
  | "laundryReady"
  | "laundrySkipRequested"
  | "extraPayRequest"
  | "caseCreated"
  | "caseUpdated"
  | "shoppingRunSubmitted"
  | "stockRunRequested"
  | "stockRunSubmitted"
  | "adminAttentionSummary"
  | "tomorrowJobsSummary"
  | "tomorrowLaundrySummary"
  | "criticalInventoryTomorrow"
  // Finance: Invoice
  | "invoice_generated"
  | "invoice_approved"
  | "invoice_sent_to_client"
  | "invoice_paid_by_client"
  | "invoice_payment_received"
  | "invoice_overdue"
  | "invoice_voided"
  | "invoice_xero_exported"
  // Finance: Payroll
  | "payroll_run_created"
  | "payroll_run_confirmed"
  | "payroll_processing"
  | "payroll_completed"
  | "payroll_failed"
  | "payout_sent"
  | "payout_failed"
  | "payout_aba_generated"
  // Finance: Pay Adjustments
  | "pay_adjustment_requested"
  | "pay_adjustment_approved"
  | "pay_adjustment_rejected"
  | "pay_adjustment_sent_to_client"
  | "pay_adjustment_client_approved"
  | "pay_adjustment_client_declined"
  | "pay_adjustment_paid"
  // Finance: Client Payments
  | "client_payment_link_created"
  | "client_payment_initiated"
  | "client_payment_succeeded"
  | "client_payment_failed"
  | "client_payment_refunded"
  // Finance: Xero
  | "xero_connected"
  | "xero_disconnected"
  | "xero_contact_synced"
  | "xero_invoice_pushed"
  | "xero_bill_created"
  | "xero_sync_error";

export interface NotificationTemplateConfig {
  webSubject: string;
  webBody: string;
  smsBody: string;
}

export type AppNotificationTemplates = Record<AppNotificationTemplateKey, NotificationTemplateConfig>;

export const COMMON_NOTIFICATION_TEMPLATE_VARIABLES = [
  "companyName",
  "projectName",
  "accountsEmail",
  "supportEmail",
  "timezone",
  "appUrl",
  "portalUrl",
  "loginUrl",
  "adminUrl",
  "cleanerUrl",
  "clientUrl",
  "laundryUrl",
  "jobsUrl",
  "reportsUrl",
  "settingsUrl",
  "currentDate",
  "currentTime",
  "currentDateTime",
  "currentDateIso",
  "currentDateTimeIso",
  "currentYear",
  "actionUrl",
  "actionLabel",
] as const;

export const NOTIFICATION_TEMPLATE_KEYS: AppNotificationTemplateKey[] = [
  "newProfileCreated",
  "jobAssigned",
  "jobRemoved",
  "jobUpdated",
  "laundryReady",
  "laundrySkipRequested",
  "extraPayRequest",
  "caseCreated",
  "caseUpdated",
  "shoppingRunSubmitted",
  "stockRunRequested",
  "stockRunSubmitted",
  "adminAttentionSummary",
  "tomorrowJobsSummary",
  "tomorrowLaundrySummary",
  "criticalInventoryTomorrow",
  // Finance: Invoice
  "invoice_generated",
  "invoice_approved",
  "invoice_sent_to_client",
  "invoice_paid_by_client",
  "invoice_payment_received",
  "invoice_overdue",
  "invoice_voided",
  "invoice_xero_exported",
  // Finance: Payroll
  "payroll_run_created",
  "payroll_run_confirmed",
  "payroll_processing",
  "payroll_completed",
  "payroll_failed",
  "payout_sent",
  "payout_failed",
  "payout_aba_generated",
  // Finance: Pay Adjustments
  "pay_adjustment_requested",
  "pay_adjustment_approved",
  "pay_adjustment_rejected",
  "pay_adjustment_sent_to_client",
  "pay_adjustment_client_approved",
  "pay_adjustment_client_declined",
  "pay_adjustment_paid",
  // Finance: Client Payments
  "client_payment_link_created",
  "client_payment_initiated",
  "client_payment_succeeded",
  "client_payment_failed",
  "client_payment_refunded",
  // Finance: Xero
  "xero_connected",
  "xero_disconnected",
  "xero_contact_synced",
  "xero_invoice_pushed",
  "xero_bill_created",
  "xero_sync_error",
];

function mergeTemplateVariableLists(...lists: ReadonlyArray<ReadonlyArray<string>>) {
  return Array.from(new Set(lists.flatMap((list) => list)));
}

const NOTIFICATION_TEMPLATE_DEFINITIONS_BASE: Record<
  AppNotificationTemplateKey,
  { label: string; variables: string[] }
> = {
  newProfileCreated: {
    label: "New Profile Created",
    variables: ["userName", "email", "role", "createdVia", "createdAt"],
  },
  jobAssigned: {
    label: "Job Assigned",
    variables: ["jobNumber", "jobType", "propertyName", "when", "timingFlags"],
  },
  jobRemoved: {
    label: "Job Removed",
    variables: ["jobNumber", "jobType", "propertyName", "when", "timingFlags"],
  },
  jobUpdated: {
    label: "Job Updated",
    variables: ["jobNumber", "propertyName", "changeSummary", "immediateAttention"],
  },
  laundryReady: {
    label: "Laundry Ready",
    variables: ["jobNumber", "propertyName", "cleanDate", "scheduledPickupDate", "scheduledDropoffDate", "bagLocation"],
  },
  laundrySkipRequested: {
    label: "Laundry Skip Requested",
    variables: ["jobNumber", "propertyName", "cleanDate", "laundryOutcome", "reasonCode", "reasonNote"],
  },
  extraPayRequest: {
    label: "Extra Pay Request",
    variables: ["jobNumber", "cleanerName", "propertyName", "requestedAmount", "requestType"],
  },
  caseCreated: {
    label: "Case Created",
    variables: ["caseTitle", "propertyName", "jobNumber", "status", "priority"],
  },
  caseUpdated: {
    label: "Case Updated",
    variables: ["caseTitle", "status", "updateNote"],
  },
  shoppingRunSubmitted: {
    label: "Shopping Run Submitted",
    variables: ["runTitle", "submittedBy", "paidBy", "actualAmount", "propertyNames"],
  },
  stockRunRequested: {
    label: "Stock Run Requested",
    variables: ["propertyName", "requestedBy", "runTitle"],
  },
  stockRunSubmitted: {
    label: "Stock Run Submitted",
    variables: ["propertyName", "submittedBy", "runTitle", "lineCount"],
  },
  adminAttentionSummary: {
    label: "Admin Attention Summary",
    variables: [
      "recipientName",
      "dateLabel",
      "attentionCount",
      "approvalCount",
      "pendingPayRequests",
      "pendingTimeAdjustments",
      "pendingContinuations",
      "pendingClientApprovals",
      "pendingLaundryRescheduleDraft",
      "unassignedJobCount",
      "openCaseCount",
      "overdueCaseCount",
      "highCaseCount",
      "newCaseCount",
      "flaggedLaundryCount",
      "breakdownText",
    ],
  },
  tomorrowJobsSummary: {
    label: "Tomorrow Jobs Summary",
    variables: ["recipientName", "roleLabel", "dateLabel", "jobCount", "summaryText"],
  },
  tomorrowLaundrySummary: {
    label: "Tomorrow Laundry Summary",
    variables: ["recipientName", "dateLabel", "taskCount", "summaryText"],
  },
  criticalInventoryTomorrow: {
    label: "Critical Inventory Tomorrow",
    variables: ["recipientName", "roleLabel", "dateLabel", "propertyCount", "itemCount", "inventoryText"],
  },
  // ── Finance: Invoice ──
  invoice_generated: { label: "Invoice generated", variables: ["invoiceNumber", "clientName", "totalAmount", "periodStart", "periodEnd", "gstAmount"] },
  invoice_approved: { label: "Invoice approved", variables: ["invoiceNumber", "clientName", "totalAmount"] },
  invoice_sent_to_client: { label: "Invoice sent to client", variables: ["invoiceNumber", "clientName", "clientEmail"] },
  invoice_paid_by_client: { label: "Invoice marked as paid", variables: ["invoiceNumber", "clientName", "totalAmount", "paidAt"] },
  invoice_payment_received: { label: "Invoice payment received (gateway)", variables: ["invoiceNumber", "clientName", "totalAmount", "gatewayProvider", "paidAt"] },
  invoice_overdue: { label: "Invoice overdue", variables: ["invoiceNumber", "clientName", "totalAmount", "dueDate"] },
  invoice_voided: { label: "Invoice voided", variables: ["invoiceNumber", "clientName", "totalAmount"] },
  invoice_xero_exported: { label: "Invoice exported to Xero", variables: ["invoiceNumber", "clientName", "xeroInvoiceId"] },
  // ── Finance: Payroll ──
  payroll_run_created: { label: "Payroll run created", variables: ["payrollRunId", "periodStart", "periodEnd", "cleanerCount", "grandTotal"] },
  payroll_run_confirmed: { label: "Payroll run confirmed", variables: ["payrollRunId", "periodStart", "periodEnd", "grandTotal"] },
  payroll_processing: { label: "Payroll processing started", variables: ["payrollRunId", "cleanerCount", "grandTotal"] },
  payroll_completed: { label: "Payroll completed", variables: ["payrollRunId", "cleanerCount", "grandTotal", "completedAt"] },
  payroll_failed: { label: "Payroll failed", variables: ["payrollRunId", "error", "failedCount"] },
  payout_sent: { label: "Payout sent to cleaner", variables: ["cleanerName", "amount", "method", "processedAt"] },
  payout_failed: { label: "Payout failed", variables: ["cleanerName", "amount", "failureReason"] },
  payout_aba_generated: { label: "ABA file generated", variables: ["payrollRunId", "payoutCount", "totalAmount"] },
  // ── Finance: Pay Adjustments ──
  pay_adjustment_requested: { label: "Pay adjustment requested", variables: ["cleanerName", "title", "requestedAmount", "scope", "type"] },
  pay_adjustment_approved: { label: "Pay adjustment approved", variables: ["cleanerName", "title", "approvedAmount", "reviewedAt"] },
  pay_adjustment_rejected: { label: "Pay adjustment rejected", variables: ["cleanerName", "title", "adminNote"] },
  pay_adjustment_sent_to_client: { label: "Pay adjustment sent to client", variables: ["clientName", "title", "requestedAmount", "cleanerName"] },
  pay_adjustment_client_approved: { label: "Client approved pay adjustment", variables: ["clientName", "title", "approvedAmount", "cleanerName"] },
  pay_adjustment_client_declined: { label: "Client declined pay adjustment", variables: ["clientName", "title", "cleanerName"] },
  pay_adjustment_paid: { label: "Pay adjustment included in payout", variables: ["cleanerName", "title", "approvedAmount", "processedAt"] },
  // ── Finance: Client Payments ──
  client_payment_link_created: { label: "Payment link created", variables: ["clientName", "invoiceNumber", "totalAmount", "paymentLink"] },
  client_payment_initiated: { label: "Client started payment", variables: ["clientName", "invoiceNumber", "totalAmount", "gatewayProvider"] },
  client_payment_succeeded: { label: "Client payment succeeded", variables: ["clientName", "invoiceNumber", "totalAmount", "gatewayProvider", "paidAt"] },
  client_payment_failed: { label: "Client payment failed", variables: ["clientName", "invoiceNumber", "totalAmount", "error"] },
  client_payment_refunded: { label: "Client payment refunded", variables: ["clientName", "invoiceNumber", "refundAmount", "refundedAt"] },
  // ── Finance: Xero ──
  xero_connected: { label: "Xero connected", variables: ["tenantName", "connectedAt"] },
  xero_disconnected: { label: "Xero disconnected", variables: ["tenantName", "disconnectedAt"] },
  xero_contact_synced: { label: "Xero contact synced", variables: ["contactName", "contactType", "xeroContactId"] },
  xero_invoice_pushed: { label: "Client invoice pushed to Xero", variables: ["invoiceNumber", "clientName", "xeroInvoiceId"] },
  xero_bill_created: { label: "Cleaner bill created in Xero", variables: ["cleanerName", "totalAmount", "xeroBillId"] },
  xero_sync_error: { label: "Xero sync error", variables: ["error", "endpoint", "timestamp"] },
};

export const NOTIFICATION_TEMPLATE_DEFINITIONS: Record<
  AppNotificationTemplateKey,
  { label: string; variables: string[] }
> = Object.fromEntries(
  Object.entries(NOTIFICATION_TEMPLATE_DEFINITIONS_BASE).map(([key, definition]) => [
    key,
    {
      ...definition,
      variables: mergeTemplateVariableLists(COMMON_NOTIFICATION_TEMPLATE_VARIABLES, definition.variables),
    },
  ])
) as Record<AppNotificationTemplateKey, { label: string; variables: string[] }>;

export function getDefaultNotificationTemplates(): AppNotificationTemplates {
  return {
    newProfileCreated: {
      webSubject: "New profile created",
      webBody: "{userName} ({email}) completed {createdVia}.",
      smsBody: "New profile: {userName} ({role}) completed {createdVia}.",
    },
    jobAssigned: {
      webSubject: "Job assignment updated ({jobNumber})",
      webBody: "{jobNumber}: Assigned to {jobType} at {propertyName} on {when}. {timingFlags}",
      smsBody: "{jobNumber} assigned: {jobType} at {propertyName} on {when}. {timingFlags}",
    },
    jobRemoved: {
      webSubject: "Job removed from schedule ({jobNumber})",
      webBody: "{jobNumber}: Removed from {jobType} at {propertyName} on {when}. {timingFlags}",
      smsBody: "{jobNumber} removed: {jobType} at {propertyName} on {when}. {timingFlags}",
    },
    jobUpdated: {
      webSubject: "Job updated ({jobNumber}){immediateAttention}",
      webBody: "{jobNumber} updated for {propertyName}. {changeSummary}",
      smsBody: "{jobNumber} updated for {propertyName}. {immediateAttention}{changeSummary}",
    },
    laundryReady: {
      webSubject: "Laundry ready - {jobNumber}",
      webBody:
        "{jobNumber} ready for pickup at {propertyName} on {cleanDate}. Pickup {scheduledPickupDate}. Drop-off {scheduledDropoffDate}. Location: {bagLocation}",
      smsBody:
        "{jobNumber}: Laundry ready for {propertyName} on {cleanDate}. Pickup {scheduledPickupDate}. Drop-off {scheduledDropoffDate}. Location: {bagLocation}.",
    },
    laundrySkipRequested: {
      webSubject: "Laundry update - {jobNumber}",
      webBody:
        "{jobNumber}: {laundryOutcome} for {propertyName}. {reasonCode}{reasonNote}",
      smsBody:
        "{jobNumber}: {laundryOutcome} for {propertyName}. {reasonCode}{reasonNote}",
    },
    extraPayRequest: {
      webSubject: "Cleaner extra pay request ({jobNumber})",
      webBody:
        "{jobNumber}: {cleanerName} requested {requestType} extra pay for {propertyName} ({requestedAmount}).",
      smsBody:
        "{jobNumber}: {cleanerName} requested {requestType} extra pay for {propertyName} ({requestedAmount}).",
    },
    caseCreated: {
      webSubject: "Case created",
      webBody: "{caseTitle} opened for {propertyName}. Job {jobNumber}. Priority: {priority}.",
      smsBody: "Case opened: {caseTitle} at {propertyName}. Job {jobNumber}. Priority: {priority}.",
    },
    caseUpdated: {
      webSubject: "Case updated",
      webBody: "{caseTitle} - {updateNote}",
      smsBody: "{caseTitle}: {updateNote}",
    },
    shoppingRunSubmitted: {
      webSubject: "Shopping run submitted",
      webBody: "{runTitle} submitted by {submittedBy}. Paid by {paidBy}. Total {actualAmount}.",
      smsBody: "{runTitle} submitted by {submittedBy}. Paid by {paidBy}. Total {actualAmount}.",
    },
    stockRunRequested: {
      webSubject: "Stock count requested",
      webBody: "{propertyName}: {requestedBy} started {runTitle}.",
      smsBody: "{propertyName}: {requestedBy} started {runTitle}.",
    },
    stockRunSubmitted: {
      webSubject: "Stock count submitted",
      webBody: "{propertyName}: {submittedBy} submitted {runTitle} ({lineCount} lines).",
      smsBody: "{propertyName}: {submittedBy} submitted {runTitle} ({lineCount} lines).",
    },
    adminAttentionSummary: {
      webSubject: "Admin attention summary - {dateLabel}",
      webBody: "{attentionCount} admin items need attention. {breakdownText}",
      smsBody: "Admin summary: {attentionCount} items. Approvals {approvalCount}; Unassigned {unassignedJobCount}; Open cases {openCaseCount}; Laundry {flaggedLaundryCount}.",
    },
    tomorrowJobsSummary: {
      webSubject: "Tomorrow jobs for {roleLabel} - {dateLabel}",
      webBody: "{jobCount} jobs scheduled for {dateLabel}. {summaryText}",
      smsBody: "Tomorrow jobs ({jobCount}) - {summaryText}",
    },
    tomorrowLaundrySummary: {
      webSubject: "Tomorrow laundry schedule - {dateLabel}",
      webBody: "{taskCount} laundry tasks scheduled for {dateLabel}. {summaryText}",
      smsBody: "Tomorrow laundry ({taskCount}) - {summaryText}",
    },
    criticalInventoryTomorrow: {
      webSubject: "Critical inventory alert for {dateLabel}",
      webBody: "{propertyCount} properties and {itemCount} items need action. {inventoryText}",
      smsBody: "Critical stock for tomorrow: {inventoryText}",
    },
    // ── Finance: Invoice ──
    invoice_generated: {
      webSubject: "Invoice {invoiceNumber} generated for {clientName}",
      webBody: "New invoice {invoiceNumber} created for {clientName}. Total: {totalAmount}. Period: {periodStart} to {periodEnd}. GST: {gstAmount}.",
      smsBody: "Invoice {invoiceNumber} generated for {clientName}: {totalAmount}",
    },
    invoice_approved: {
      webSubject: "Invoice {invoiceNumber} approved",
      webBody: "Invoice {invoiceNumber} for {clientName} has been approved. Total: {totalAmount}.",
      smsBody: "Invoice {invoiceNumber} approved: {totalAmount}",
    },
    invoice_sent_to_client: {
      webSubject: "Invoice {invoiceNumber} sent to {clientName}",
      webBody: "Invoice {invoiceNumber} has been emailed to {clientName} at {clientEmail}.",
      smsBody: "Invoice {invoiceNumber} sent to {clientName}",
    },
    invoice_paid_by_client: {
      webSubject: "Invoice {invoiceNumber} paid by {clientName}",
      webBody: "Invoice {invoiceNumber} for {clientName} has been marked as paid. Total: {totalAmount}. Paid at: {paidAt}.",
      smsBody: "Invoice {invoiceNumber} paid: {totalAmount}",
    },
    invoice_payment_received: {
      webSubject: "Payment received for invoice {invoiceNumber}",
      webBody: "Payment of {totalAmount} received for invoice {invoiceNumber} via {gatewayProvider}. Paid at: {paidAt}.",
      smsBody: "Payment received: {totalAmount} for invoice {invoiceNumber} via {gatewayProvider}",
    },
    invoice_overdue: {
      webSubject: "Overdue: Invoice {invoiceNumber} for {clientName}",
      webBody: "Invoice {invoiceNumber} for {clientName} is overdue. Amount: {totalAmount}. Due date: {dueDate}. Please follow up.",
      smsBody: "Overdue invoice {invoiceNumber}: {totalAmount} (due {dueDate})",
    },
    invoice_voided: {
      webSubject: "Invoice {invoiceNumber} voided",
      webBody: "Invoice {invoiceNumber} for {clientName} has been voided. Amount: {totalAmount}.",
      smsBody: "Invoice {invoiceNumber} voided: {totalAmount}",
    },
    invoice_xero_exported: {
      webSubject: "Invoice {invoiceNumber} exported to Xero",
      webBody: "Invoice {invoiceNumber} for {clientName} has been exported to Xero (ID: {xeroInvoiceId}).",
      smsBody: "Invoice {invoiceNumber} exported to Xero",
    },
    // ── Finance: Payroll ──
    payroll_run_created: {
      webSubject: "Payroll run created: {periodStart} to {periodEnd}",
      webBody: "New payroll run {payrollRunId} created for {periodStart} to {periodEnd}. {cleanerCount} cleaners. Grand total: {grandTotal}.",
      smsBody: "Payroll run created: {cleanerCount} cleaners, {grandTotal}",
    },
    payroll_run_confirmed: {
      webSubject: "Payroll run confirmed: {grandTotal}",
      webBody: "Payroll run {payrollRunId} confirmed for {periodStart} to {periodEnd}. Grand total: {grandTotal}. Ready for processing.",
      smsBody: "Payroll confirmed: {grandTotal}",
    },
    payroll_processing: {
      webSubject: "Payroll processing started",
      webBody: "Processing payroll run {payrollRunId}. {cleanerCount} payouts totalling {grandTotal}.",
      smsBody: "Payroll processing: {cleanerCount} payouts, {grandTotal}",
    },
    payroll_completed: {
      webSubject: "Payroll completed successfully",
      webBody: "Payroll run {payrollRunId} completed at {completedAt}. {cleanerCount} cleaners paid. Grand total: {grandTotal}.",
      smsBody: "Payroll completed: {cleanerCount} cleaners, {grandTotal}",
    },
    payroll_failed: {
      webSubject: "Payroll processing failed",
      webBody: "Payroll run {payrollRunId} failed. Error: {error}. {failedCount} payouts failed. Please review and retry.",
      smsBody: "Payroll FAILED: {error}",
    },
    payout_sent: {
      webSubject: "Your payment has been processed",
      webBody: "Hi {cleanerName}, your payment of {amount} has been processed via {method} on {processedAt}. Thank you for your work.",
      smsBody: "Payment of {amount} processed via {method} on {processedAt}. Thank you!",
    },
    payout_failed: {
      webSubject: "Payment failed for {cleanerName}",
      webBody: "Payment of {amount} for {cleanerName} failed. Reason: {failureReason}. Please update bank details and retry.",
      smsBody: "Payment failed: {amount}. Reason: {failureReason}",
    },
    payout_aba_generated: {
      webSubject: "ABA file generated for payroll {payrollRunId}",
      webBody: "ABA payment file generated for payroll {payrollRunId}. {payoutCount} payouts totalling {totalAmount}. Upload to your bank portal to process.",
      smsBody: "ABA file generated: {payoutCount} payouts, {totalAmount}",
    },
    // ── Finance: Pay Adjustments ──
    pay_adjustment_requested: {
      webSubject: "Pay request from {cleanerName}: {title}",
      webBody: "{cleanerName} submitted a {type} pay request: {title}. Amount: {requestedAmount}. Scope: {scope}. Please review.",
      smsBody: "Pay request from {cleanerName}: {requestedAmount} - {title}",
    },
    pay_adjustment_approved: {
      webSubject: "Pay request approved: {title}",
      webBody: "Your pay request '{title}' has been approved for {approvedAmount}. This will be included in your next payroll run.",
      smsBody: "Pay request approved: {approvedAmount} - {title}",
    },
    pay_adjustment_rejected: {
      webSubject: "Pay request declined: {title}",
      webBody: "Your pay request '{title}' has been declined. Note: {adminNote}. Please contact your admin if you have questions.",
      smsBody: "Pay request declined: {title}",
    },
    pay_adjustment_sent_to_client: {
      webSubject: "Pay adjustment for your review: {title}",
      webBody: "{clientName}, {cleanerName} has requested extra pay: {title} ({requestedAmount}). Please review and approve or decline.",
      smsBody: "Pay adjustment for review: {title} ({requestedAmount})",
    },
    pay_adjustment_client_approved: {
      webSubject: "Client approved: {title}",
      webBody: "{clientName} approved the pay request '{title}' for {approvedAmount} ({cleanerName}). You can now approve the payout.",
      smsBody: "Client approved: {title} ({approvedAmount})",
    },
    pay_adjustment_client_declined: {
      webSubject: "Client declined: {title}",
      webBody: "{clientName} declined the pay request '{title}' for {cleanerName}. Please review and advise the cleaner.",
      smsBody: "Client declined: {title}",
    },
    pay_adjustment_paid: {
      webSubject: "Pay request included in payout: {title}",
      webBody: "Your pay request '{title}' ({approvedAmount}) has been included in your latest payout processed on {processedAt}.",
      smsBody: "Pay request paid: {approvedAmount} - {title}",
    },
    // ── Finance: Client Payments ──
    client_payment_link_created: {
      webSubject: "Payment link for invoice {invoiceNumber}",
      webBody: "{clientName}, a payment link has been created for invoice {invoiceNumber}. Amount: {totalAmount}. Pay now: {paymentLink}",
      smsBody: "Payment link for invoice {invoiceNumber}: {totalAmount}. Pay: {paymentLink}",
    },
    client_payment_initiated: {
      webSubject: "Payment started for invoice {invoiceNumber}",
      webBody: "{clientName} has started paying invoice {invoiceNumber} ({totalAmount}) via {gatewayProvider}.",
      smsBody: "Payment initiated: {invoiceNumber} via {gatewayProvider}",
    },
    client_payment_succeeded: {
      webSubject: "Payment received: Invoice {invoiceNumber}",
      webBody: "Payment of {totalAmount} received for invoice {invoiceNumber} from {clientName} via {gatewayProvider}. Paid at: {paidAt}.",
      smsBody: "Payment received: {totalAmount} for invoice {invoiceNumber}",
    },
    client_payment_failed: {
      webSubject: "Payment failed for invoice {invoiceNumber}",
      webBody: "{clientName}, your payment attempt for invoice {invoiceNumber} ({totalAmount}) failed. Error: {error}. Please try again or contact us.",
      smsBody: "Payment failed for invoice {invoiceNumber}: {error}",
    },
    client_payment_refunded: {
      webSubject: "Refund processed for invoice {invoiceNumber}",
      webBody: "A refund of {refundAmount} has been processed for invoice {invoiceNumber} ({clientName}) on {refundedAt}.",
      smsBody: "Refund of {refundAmount} processed for invoice {invoiceNumber}",
    },
    // ── Finance: Xero ──
    xero_connected: {
      webSubject: "Xero connected: {tenantName}",
      webBody: "Xero account '{tenantName}' has been successfully connected at {connectedAt}. You can now sync contacts and invoices.",
      smsBody: "Xero connected: {tenantName}",
    },
    xero_disconnected: {
      webSubject: "Xero disconnected: {tenantName}",
      webBody: "Xero account '{tenantName}' has been disconnected at {disconnectedAt}. Please reconnect to resume syncing.",
      smsBody: "Xero disconnected: {tenantName}",
    },
    xero_contact_synced: {
      webSubject: "Contact synced to Xero: {contactName}",
      webBody: "Contact '{contactName}' ({contactType}) has been synced to Xero (ID: {xeroContactId}).",
      smsBody: "Contact synced: {contactName} ({contactType})",
    },
    xero_invoice_pushed: {
      webSubject: "Invoice {invoiceNumber} pushed to Xero",
      webBody: "Invoice {invoiceNumber} for {clientName} has been pushed to Xero as a draft (ID: {xeroInvoiceId}).",
      smsBody: "Invoice {invoiceNumber} pushed to Xero",
    },
    xero_bill_created: {
      webSubject: "Bill created in Xero for {cleanerName}",
      webBody: "A bill for {cleanerName} totalling {totalAmount} has been created in Xero (ID: {xeroBillId}).",
      smsBody: "Xero bill created: {cleanerName} - {totalAmount}",
    },
    xero_sync_error: {
      webSubject: "Xero sync error",
      webBody: "Xero sync failed at {timestamp}. Endpoint: {endpoint}. Error: {error}. Please check your connection and retry.",
      smsBody: "Xero sync error: {error}",
    },
  };
}

function sanitizeText(value: unknown, max = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function sanitizeNotificationTemplates(
  input: unknown,
  fallback: AppNotificationTemplates
): AppNotificationTemplates {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const parsed = input as Record<string, unknown>;
  const next = { ...fallback };
  for (const key of NOTIFICATION_TEMPLATE_KEYS) {
    const row = parsed[key];
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const template = row as Record<string, unknown>;
    next[key] = {
      webSubject: sanitizeText(template.webSubject, 200) || fallback[key].webSubject,
      webBody: sanitizeText(template.webBody, 2000) || fallback[key].webBody,
      smsBody: sanitizeText(template.smsBody, 320) || fallback[key].smsBody,
    };
  }
  return next;
}

function normalizeVariables(variables: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [key, String(value ?? "")])
  );
}

function buildCommonNotificationVariables(settings: {
  companyName?: string;
  projectName?: string;
  accountsEmail?: string;
  timezone?: string;
}) {
  const timezone = (settings.timezone || "Australia/Sydney").trim() || "Australia/Sydney";
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  const dateTimeFormatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const appUrl = resolveAppUrl("/");

  return {
    companyName: settings.companyName ?? "",
    projectName: settings.projectName ?? "",
    accountsEmail: settings.accountsEmail ?? "",
    supportEmail: settings.accountsEmail ?? "",
    timezone,
    appUrl,
    portalUrl: appUrl,
    loginUrl: resolveAppUrl("/login"),
    adminUrl: resolveAppUrl("/admin"),
    cleanerUrl: resolveAppUrl("/cleaner"),
    clientUrl: resolveAppUrl("/client"),
    laundryUrl: resolveAppUrl("/laundry"),
    jobsUrl: resolveAppUrl("/admin/jobs"),
    reportsUrl: resolveAppUrl("/admin/reports"),
    settingsUrl: resolveAppUrl("/admin/settings"),
    currentDate: dateFormatter.format(now),
    currentTime: timeFormatter.format(now),
    currentDateTime: dateTimeFormatter.format(now),
    currentDateIso: now.toISOString().slice(0, 10),
    currentDateTimeIso: now.toISOString(),
    currentYear: String(now.getUTCFullYear()),
    actionUrl: "",
    actionLabel: "Open details",
  };
}

function replaceVariables(template: string, variables: Record<string, string>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) => variables[name] ?? "");
}

export function renderNotificationTemplate(
  settings: {
    notificationTemplates: AppNotificationTemplates;
    companyName?: string;
    projectName?: string;
    accountsEmail?: string;
    timezone?: string;
  },
  key: AppNotificationTemplateKey,
  variables: Record<string, unknown>
) {
  const mergedVariables = normalizeVariables({
    ...buildCommonNotificationVariables(settings),
    ...variables,
  });
  const template = settings.notificationTemplates[key] ?? getDefaultNotificationTemplates()[key];
  return {
    webSubject: replaceVariables(template.webSubject, mergedVariables),
    webBody: replaceVariables(template.webBody, mergedVariables),
    smsBody: replaceVariables(template.smsBody, mergedVariables),
  };
}
