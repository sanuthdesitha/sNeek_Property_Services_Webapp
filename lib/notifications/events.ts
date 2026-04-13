// Finance notification event definitions
// Each event has a key, category, label, default recipients, and available template variables.

export type FinanceNotificationEvent = typeof FINANCE_EVENTS[number]["key"];

export const FINANCE_EVENTS = [
  // ── Invoice events ──
  { key: "invoice_generated", category: "invoice", label: "Invoice generated", defaultRecipients: ["ADMIN"], defaultChannels: ["EMAIL", "PUSH"], variables: ["invoiceNumber", "clientName", "totalAmount", "periodStart", "periodEnd"] },
  { key: "invoice_approved", category: "invoice", label: "Invoice approved", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["invoiceNumber", "clientName", "totalAmount"] },
  { key: "invoice_sent_to_client", category: "invoice", label: "Invoice sent to client", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["invoiceNumber", "clientName", "clientEmail"] },
  { key: "invoice_paid_by_client", category: "invoice", label: "Invoice marked as paid", defaultRecipients: ["ADMIN"], defaultChannels: ["EMAIL", "PUSH"], variables: ["invoiceNumber", "clientName", "totalAmount", "paidAt"] },
  { key: "invoice_payment_received", category: "invoice", label: "Invoice payment received (gateway)", defaultRecipients: ["ADMIN", "CLIENT"], defaultChannels: ["EMAIL"], variables: ["invoiceNumber", "clientName", "totalAmount", "gatewayProvider", "paidAt"] },
  { key: "invoice_overdue", category: "invoice", label: "Invoice overdue", defaultRecipients: ["ADMIN", "CLIENT"], defaultChannels: ["EMAIL"], variables: ["invoiceNumber", "clientName", "totalAmount", "dueDate"] },
  { key: "invoice_voided", category: "invoice", label: "Invoice voided", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["invoiceNumber", "clientName", "totalAmount"] },
  { key: "invoice_xero_exported", category: "invoice", label: "Invoice exported to Xero", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["invoiceNumber", "clientName", "xeroInvoiceId"] },

  // ── Payroll events ──
  { key: "payroll_run_created", category: "payroll", label: "Payroll run created", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["payrollRunId", "periodStart", "periodEnd", "cleanerCount", "grandTotal"] },
  { key: "payroll_run_confirmed", category: "payroll", label: "Payroll run confirmed", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["payrollRunId", "periodStart", "periodEnd", "grandTotal"] },
  { key: "payroll_processing", category: "payroll", label: "Payroll processing started", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["payrollRunId", "cleanerCount", "grandTotal"] },
  { key: "payroll_completed", category: "payroll", label: "Payroll completed", defaultRecipients: ["ADMIN"], defaultChannels: ["EMAIL", "PUSH"], variables: ["payrollRunId", "cleanerCount", "grandTotal", "completedAt"] },
  { key: "payroll_failed", category: "payroll", label: "Payroll failed", defaultRecipients: ["ADMIN"], defaultChannels: ["EMAIL", "PUSH"], variables: ["payrollRunId", "error", "failedCount"] },
  { key: "payout_sent", category: "payroll", label: "Payout sent to cleaner", defaultRecipients: ["CLEANER"], defaultChannels: ["EMAIL"], variables: ["cleanerName", "amount", "method", "processedAt"] },
  { key: "payout_failed", category: "payroll", label: "Payout failed", defaultRecipients: ["ADMIN", "CLEANER"], defaultChannels: ["EMAIL"], variables: ["cleanerName", "amount", "failureReason"] },
  { key: "payout_aba_generated", category: "payroll", label: "ABA file generated", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["payrollRunId", "payoutCount", "totalAmount"] },

  // ── Pay adjustment events ──
  { key: "pay_adjustment_requested", category: "pay_adjustment", label: "Pay adjustment requested", defaultRecipients: ["ADMIN"], defaultChannels: ["EMAIL", "PUSH"], variables: ["cleanerName", "title", "requestedAmount", "scope", "type"] },
  { key: "pay_adjustment_approved", category: "pay_adjustment", label: "Pay adjustment approved", defaultRecipients: ["CLEANER"], defaultChannels: ["EMAIL"], variables: ["cleanerName", "title", "approvedAmount", "reviewedAt"] },
  { key: "pay_adjustment_rejected", category: "pay_adjustment", label: "Pay adjustment rejected", defaultRecipients: ["CLEANER"], defaultChannels: ["EMAIL"], variables: ["cleanerName", "title", "adminNote"] },
  { key: "pay_adjustment_sent_to_client", category: "pay_adjustment", label: "Pay adjustment sent to client", defaultRecipients: ["CLIENT"], defaultChannels: ["EMAIL"], variables: ["clientName", "title", "requestedAmount", "cleanerName"] },
  { key: "pay_adjustment_client_approved", category: "pay_adjustment", label: "Client approved pay adjustment", defaultRecipients: ["ADMIN"], defaultChannels: ["EMAIL", "PUSH"], variables: ["clientName", "title", "approvedAmount", "cleanerName"] },
  { key: "pay_adjustment_client_declined", category: "pay_adjustment", label: "Client declined pay adjustment", defaultRecipients: ["ADMIN", "CLEANER"], defaultChannels: ["EMAIL"], variables: ["clientName", "title", "cleanerName"] },
  { key: "pay_adjustment_paid", category: "pay_adjustment", label: "Pay adjustment included in payout", defaultRecipients: ["CLEANER"], defaultChannels: ["EMAIL"], variables: ["cleanerName", "title", "approvedAmount", "processedAt"] },

  // ── Client payment events ──
  { key: "client_payment_link_created", category: "client_payment", label: "Payment link created", defaultRecipients: ["CLIENT"], defaultChannels: ["EMAIL"], variables: ["clientName", "invoiceNumber", "totalAmount", "paymentLink"] },
  { key: "client_payment_initiated", category: "client_payment", label: "Client started payment", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["clientName", "invoiceNumber", "totalAmount", "gatewayProvider"] },
  { key: "client_payment_succeeded", category: "client_payment", label: "Client payment succeeded", defaultRecipients: ["ADMIN", "CLIENT"], defaultChannels: ["EMAIL"], variables: ["clientName", "invoiceNumber", "totalAmount", "gatewayProvider", "paidAt"] },
  { key: "client_payment_failed", category: "client_payment", label: "Client payment failed", defaultRecipients: ["CLIENT"], defaultChannels: ["EMAIL"], variables: ["clientName", "invoiceNumber", "totalAmount", "error"] },
  { key: "client_payment_refunded", category: "client_payment", label: "Client payment refunded", defaultRecipients: ["ADMIN", "CLIENT"], defaultChannels: ["EMAIL"], variables: ["clientName", "invoiceNumber", "refundAmount", "refundedAt"] },

  // ── Xero events ──
  { key: "xero_connected", category: "xero", label: "Xero connected", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["tenantName", "connectedAt"] },
  { key: "xero_disconnected", category: "xero", label: "Xero disconnected", defaultRecipients: ["ADMIN"], defaultChannels: ["EMAIL"], variables: ["tenantName", "disconnectedAt"] },
  { key: "xero_contact_synced", category: "xero", label: "Xero contact synced", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["contactName", "contactType", "xeroContactId"] },
  { key: "xero_invoice_pushed", category: "xero", label: "Client invoice pushed to Xero", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["invoiceNumber", "clientName", "xeroInvoiceId"] },
  { key: "xero_bill_created", category: "xero", label: "Cleaner bill created in Xero", defaultRecipients: ["ADMIN"], defaultChannels: ["PUSH"], variables: ["cleanerName", "totalAmount", "xeroBillId"] },
  { key: "xero_sync_error", category: "xero", label: "Xero sync error", defaultRecipients: ["ADMIN"], defaultChannels: ["EMAIL"], variables: ["error", "endpoint", "timestamp"] },
] as const;

export const FINANCE_EVENT_CATEGORIES = ["invoice", "payroll", "pay_adjustment", "client_payment", "xero"] as const;
