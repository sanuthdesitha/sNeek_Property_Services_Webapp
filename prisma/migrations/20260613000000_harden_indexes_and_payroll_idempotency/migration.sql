-- Payroll idempotency: marks a job whose cleaner pay has been captured by a run.
ALTER TABLE "Job" ADD COLUMN "payrollRunId" TEXT;

-- Hot-path indexes (Job had none; it is the busiest table).
CREATE INDEX "Job_scheduledDate_idx" ON "Job"("scheduledDate");
CREATE INDEX "Job_status_scheduledDate_idx" ON "Job"("status", "scheduledDate");
CREATE INDEX "Job_propertyId_scheduledDate_idx" ON "Job"("propertyId", "scheduledDate");
CREATE INDEX "Job_completedAt_idx" ON "Job"("completedAt");
CREATE INDEX "Job_status_completedAt_idx" ON "Job"("status", "completedAt");
CREATE INDEX "Job_payrollRunId_idx" ON "Job"("payrollRunId");

-- Notification SSE stream polls (userId, channel, createdAt) every few seconds.
CREATE INDEX "Notification_userId_channel_createdAt_idx" ON "Notification"("userId", "channel", "createdAt");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- AuditLog: append-only, queried by createdAt / entity / user / job.
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "AuditLog_jobId_idx" ON "AuditLog"("jobId");

-- Invoice dashboards + dedupe scans.
CREATE INDEX "ClientInvoice_status_idx" ON "ClientInvoice"("status");
CREATE INDEX "ClientInvoice_clientId_status_idx" ON "ClientInvoice"("clientId", "status");
CREATE INDEX "ClientInvoiceLine_jobId_idx" ON "ClientInvoiceLine"("jobId");
CREATE INDEX "ClientInvoiceLine_invoiceId_idx" ON "ClientInvoiceLine"("invoiceId");

-- QA + laundry finance hot paths.
CREATE INDEX "QAReview_jobId_idx" ON "QAReview"("jobId");
CREATE INDEX "QAReview_createdAt_idx" ON "QAReview"("createdAt");
CREATE INDEX "LaundryTask_droppedAt_idx" ON "LaundryTask"("droppedAt");
CREATE INDEX "LaundryTask_status_idx" ON "LaundryTask"("status");
