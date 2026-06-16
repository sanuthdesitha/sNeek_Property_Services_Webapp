-- Phase 1b: add nullable organizationId to every tenant-owned model.
-- Additive + nullable → safe on a live single-tenant DB. Backfill to Org #1
-- and set NOT NULL in a follow-up migration after the leak audit.

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Client_organizationId_idx" ON "Client"("organizationId");
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Property_organizationId_idx" ON "Property"("organizationId");
ALTER TABLE "Property" ADD CONSTRAINT "Property_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Job_organizationId_idx" ON "Job"("organizationId");
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Reservation_organizationId_idx" ON "Reservation"("organizationId");
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobAssignment" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "JobAssignment_organizationId_idx" ON "JobAssignment"("organizationId");
ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeLog" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "TimeLog_organizationId_idx" ON "TimeLog"("organizationId");
ALTER TABLE "TimeLog" ADD CONSTRAINT "TimeLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeLogAdjustmentRequest" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "TimeLogAdjustmentRequest_organizationId_idx" ON "TimeLogAdjustmentRequest"("organizationId");
ALTER TABLE "TimeLogAdjustmentRequest" ADD CONSTRAINT "TimeLogAdjustmentRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CleanerPayAdjustment" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "CleanerPayAdjustment_organizationId_idx" ON "CleanerPayAdjustment"("organizationId");
ALTER TABLE "CleanerPayAdjustment" ADD CONSTRAINT "CleanerPayAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CleanerAvailability" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "CleanerAvailability_organizationId_idx" ON "CleanerAvailability"("organizationId");
ALTER TABLE "CleanerAvailability" ADD CONSTRAINT "CleanerAvailability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CleanerLocationPing" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "CleanerLocationPing_organizationId_idx" ON "CleanerLocationPing"("organizationId");
ALTER TABLE "CleanerLocationPing" ADD CONSTRAINT "CleanerLocationPing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FormTemplate" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "FormTemplate_organizationId_idx" ON "FormTemplate"("organizationId");
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FormSubmission" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "FormSubmission_organizationId_idx" ON "FormSubmission"("organizationId");
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubmissionMedia" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "SubmissionMedia_organizationId_idx" ON "SubmissionMedia"("organizationId");
ALTER TABLE "SubmissionMedia" ADD CONSTRAINT "SubmissionMedia_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QAReview" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "QAReview_organizationId_idx" ON "QAReview"("organizationId");
ALTER TABLE "QAReview" ADD CONSTRAINT "QAReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QaFormTemplate" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "QaFormTemplate_organizationId_idx" ON "QaFormTemplate"("organizationId");
ALTER TABLE "QaFormTemplate" ADD CONSTRAINT "QaFormTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QaAssignment" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "QaAssignment_organizationId_idx" ON "QaAssignment"("organizationId");
ALTER TABLE "QaAssignment" ADD CONSTRAINT "QaAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QaReworkTransfer" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "QaReworkTransfer_organizationId_idx" ON "QaReworkTransfer"("organizationId");
ALTER TABLE "QaReworkTransfer" ADD CONSTRAINT "QaReworkTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QaFormSubmission" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "QaFormSubmission_organizationId_idx" ON "QaFormSubmission"("organizationId");
ALTER TABLE "QaFormSubmission" ADD CONSTRAINT "QaFormSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaOverrideRequest" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "MediaOverrideRequest_organizationId_idx" ON "MediaOverrideRequest"("organizationId");
ALTER TABLE "MediaOverrideRequest" ADD CONSTRAINT "MediaOverrideRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Report_organizationId_idx" ON "Report"("organizationId");
ALTER TABLE "Report" ADD CONSTRAINT "Report_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportTheme" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ReportTheme_organizationId_idx" ON "ReportTheme"("organizationId");
ALTER TABLE "ReportTheme" ADD CONSTRAINT "ReportTheme_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueTicket" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "IssueTicket_organizationId_idx" ON "IssueTicket"("organizationId");
ALTER TABLE "IssueTicket" ADD CONSTRAINT "IssueTicket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CaseTransition" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "CaseTransition_organizationId_idx" ON "CaseTransition"("organizationId");
ALTER TABLE "CaseTransition" ADD CONSTRAINT "CaseTransition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CaseComment" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "CaseComment_organizationId_idx" ON "CaseComment"("organizationId");
ALTER TABLE "CaseComment" ADD CONSTRAINT "CaseComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CaseAttachment" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "CaseAttachment_organizationId_idx" ON "CaseAttachment"("organizationId");
ALTER TABLE "CaseAttachment" ADD CONSTRAINT "CaseAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobTask" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "JobTask_organizationId_idx" ON "JobTask"("organizationId");
ALTER TABLE "JobTask" ADD CONSTRAINT "JobTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobTaskAttachment" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "JobTaskAttachment_organizationId_idx" ON "JobTaskAttachment"("organizationId");
ALTER TABLE "JobTaskAttachment" ADD CONSTRAINT "JobTaskAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobTaskEvent" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "JobTaskEvent_organizationId_idx" ON "JobTaskEvent"("organizationId");
ALTER TABLE "JobTaskEvent" ADD CONSTRAINT "JobTaskEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "InventoryItem_organizationId_idx" ON "InventoryItem"("organizationId");
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyStock" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "PropertyStock_organizationId_idx" ON "PropertyStock"("organizationId");
ALTER TABLE "PropertyStock" ADD CONSTRAINT "PropertyStock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockTx" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "StockTx_organizationId_idx" ON "StockTx"("organizationId");
ALTER TABLE "StockTx" ADD CONSTRAINT "StockTx_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockRun" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "StockRun_organizationId_idx" ON "StockRun"("organizationId");
ALTER TABLE "StockRun" ADD CONSTRAINT "StockRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockRunLine" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "StockRunLine_organizationId_idx" ON "StockRunLine"("organizationId");
ALTER TABLE "StockRunLine" ADD CONSTRAINT "StockRunLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShoppingRun" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ShoppingRun_organizationId_idx" ON "ShoppingRun"("organizationId");
ALTER TABLE "ShoppingRun" ADD CONSTRAINT "ShoppingRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShoppingRunLine" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ShoppingRunLine_organizationId_idx" ON "ShoppingRunLine"("organizationId");
ALTER TABLE "ShoppingRunLine" ADD CONSTRAINT "ShoppingRunLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShoppingReceipt" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ShoppingReceipt_organizationId_idx" ON "ShoppingReceipt"("organizationId");
ALTER TABLE "ShoppingReceipt" ADD CONSTRAINT "ShoppingReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShoppingSettlement" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ShoppingSettlement_organizationId_idx" ON "ShoppingSettlement"("organizationId");
ALTER TABLE "ShoppingSettlement" ADD CONSTRAINT "ShoppingSettlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LaundryTask" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "LaundryTask_organizationId_idx" ON "LaundryTask"("organizationId");
ALTER TABLE "LaundryTask" ADD CONSTRAINT "LaundryTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LaundryConfirmation" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "LaundryConfirmation_organizationId_idx" ON "LaundryConfirmation"("organizationId");
ALTER TABLE "LaundryConfirmation" ADD CONSTRAINT "LaundryConfirmation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LaundrySupplier" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "LaundrySupplier_organizationId_idx" ON "LaundrySupplier"("organizationId");
ALTER TABLE "LaundrySupplier" ADD CONSTRAINT "LaundrySupplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyMaintenanceItem" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "PropertyMaintenanceItem_organizationId_idx" ON "PropertyMaintenanceItem"("organizationId");
ALTER TABLE "PropertyMaintenanceItem" ADD CONSTRAINT "PropertyMaintenanceItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyMaintenanceEvent" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "PropertyMaintenanceEvent_organizationId_idx" ON "PropertyMaintenanceEvent"("organizationId");
ALTER TABLE "PropertyMaintenanceEvent" ADD CONSTRAINT "PropertyMaintenanceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PriceBook" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "PriceBook_organizationId_idx" ON "PriceBook"("organizationId");
ALTER TABLE "PriceBook" ADD CONSTRAINT "PriceBook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscountCampaign" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "DiscountCampaign_organizationId_idx" ON "DiscountCampaign"("organizationId");
ALTER TABLE "DiscountCampaign" ADD CONSTRAINT "DiscountCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "SubscriptionPlan_organizationId_idx" ON "SubscriptionPlan"("organizationId");
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyClientRate" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "PropertyClientRate_organizationId_idx" ON "PropertyClientRate"("organizationId");
ALTER TABLE "PropertyClientRate" ADD CONSTRAINT "PropertyClientRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteLead" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "QuoteLead_organizationId_idx" ON "QuoteLead"("organizationId");
ALTER TABLE "QuoteLead" ADD CONSTRAINT "QuoteLead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Quote_organizationId_idx" ON "Quote"("organizationId");
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientInvoice" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ClientInvoice_organizationId_idx" ON "ClientInvoice"("organizationId");
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientInvoiceLine" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ClientInvoiceLine_organizationId_idx" ON "ClientInvoiceLine"("organizationId");
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ClientPayment_organizationId_idx" ON "ClientPayment"("organizationId");
ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentGateway" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "PaymentGateway_organizationId_idx" ON "PaymentGateway"("organizationId");
ALTER TABLE "PaymentGateway" ADD CONSTRAINT "PaymentGateway_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "PayrollRun_organizationId_idx" ON "PayrollRun"("organizationId");
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Payout_organizationId_idx" ON "Payout"("organizationId");
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BlogPost" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "BlogPost_organizationId_idx" ON "BlogPost"("organizationId");
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientSatisfactionRating" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ClientSatisfactionRating_organizationId_idx" ON "ClientSatisfactionRating"("organizationId");
ALTER TABLE "ClientSatisfactionRating" ADD CONSTRAINT "ClientSatisfactionRating_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoyaltyAccount" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "LoyaltyAccount_organizationId_idx" ON "LoyaltyAccount"("organizationId");
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoyaltyTransaction" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_organizationId_idx" ON "LoyaltyTransaction"("organizationId");
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Referral_organizationId_idx" ON "Referral"("organizationId");
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientMessage" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ClientMessage_organizationId_idx" ON "ClientMessage"("organizationId");
ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailCampaign" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "EmailCampaign_organizationId_idx" ON "EmailCampaign"("organizationId");
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketingAsset" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "MarketingAsset_organizationId_idx" ON "MarketingAsset"("organizationId");
ALTER TABLE "MarketingAsset" ADD CONSTRAINT "MarketingAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialPost" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "SocialPost_organizationId_idx" ON "SocialPost"("organizationId");
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialPostAsset" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "SocialPostAsset_organizationId_idx" ON "SocialPostAsset"("organizationId");
ALTER TABLE "SocialPostAsset" ADD CONSTRAINT "SocialPostAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobFeedback" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "JobFeedback_organizationId_idx" ON "JobFeedback"("organizationId");
ALTER TABLE "JobFeedback" ADD CONSTRAINT "JobFeedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Notification_organizationId_idx" ON "Notification"("organizationId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationTemplate" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "NotificationTemplate_organizationId_idx" ON "NotificationTemplate"("organizationId");
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "NotificationPreference_organizationId_idx" ON "NotificationPreference"("organizationId");
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationLog" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "NotificationLog_organizationId_idx" ON "NotificationLog"("organizationId");
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "MessageTemplate_organizationId_idx" ON "MessageTemplate"("organizationId");
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientAutomationRule" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ClientAutomationRule_organizationId_idx" ON "ClientAutomationRule"("organizationId");
ALTER TABLE "ClientAutomationRule" ADD CONSTRAINT "ClientAutomationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "UserNotificationPreference_organizationId_idx" ON "UserNotificationPreference"("organizationId");
ALTER TABLE "UserNotificationPreference" ADD CONSTRAINT "UserNotificationPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientNotificationPreference" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ClientNotificationPreference_organizationId_idx" ON "ClientNotificationPreference"("organizationId");
ALTER TABLE "ClientNotificationPreference" ADD CONSTRAINT "ClientNotificationPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPushDevice" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "UserPushDevice_organizationId_idx" ON "UserPushDevice"("organizationId");
ALTER TABLE "UserPushDevice" ADD CONSTRAINT "UserPushDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "PushSubscription_organizationId_idx" ON "PushSubscription"("organizationId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamGroup" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "TeamGroup_organizationId_idx" ON "TeamGroup"("organizationId");
ALTER TABLE "TeamGroup" ADD CONSTRAINT "TeamGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamGroupMember" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "TeamGroupMember_organizationId_idx" ON "TeamGroupMember"("organizationId");
ALTER TABLE "TeamGroupMember" ADD CONSTRAINT "TeamGroupMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkforcePost" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "WorkforcePost_organizationId_idx" ON "WorkforcePost"("organizationId");
ALTER TABLE "WorkforcePost" ADD CONSTRAINT "WorkforcePost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkforcePostRead" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "WorkforcePostRead_organizationId_idx" ON "WorkforcePostRead"("organizationId");
ALTER TABLE "WorkforcePostRead" ADD CONSTRAINT "WorkforcePostRead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatChannel" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ChatChannel_organizationId_idx" ON "ChatChannel"("organizationId");
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ChatMessage_organizationId_idx" ON "ChatMessage"("organizationId");
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatChannelRead" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "ChatChannelRead_organizationId_idx" ON "ChatChannelRead"("organizationId");
ALTER TABLE "ChatChannelRead" ADD CONSTRAINT "ChatChannelRead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningPath" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "LearningPath_organizationId_idx" ON "LearningPath"("organizationId");
ALTER TABLE "LearningPath" ADD CONSTRAINT "LearningPath_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningAssignment" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "LearningAssignment_organizationId_idx" ON "LearningAssignment"("organizationId");
ALTER TABLE "LearningAssignment" ADD CONSTRAINT "LearningAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffDocument" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "StaffDocument_organizationId_idx" ON "StaffDocument"("organizationId");
ALTER TABLE "StaffDocument" ADD CONSTRAINT "StaffDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffDocumentRequest" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "StaffDocumentRequest_organizationId_idx" ON "StaffDocumentRequest"("organizationId");
ALTER TABLE "StaffDocumentRequest" ADD CONSTRAINT "StaffDocumentRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffRecognition" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "StaffRecognition_organizationId_idx" ON "StaffRecognition"("organizationId");
ALTER TABLE "StaffRecognition" ADD CONSTRAINT "StaffRecognition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HiringPosition" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "HiringPosition_organizationId_idx" ON "HiringPosition"("organizationId");
ALTER TABLE "HiringPosition" ADD CONSTRAINT "HiringPosition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HiringApplication" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "HiringApplication_organizationId_idx" ON "HiringApplication"("organizationId");
ALTER TABLE "HiringApplication" ADD CONSTRAINT "HiringApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserInvitation" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "UserInvitation_organizationId_idx" ON "UserInvitation"("organizationId");
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyOnboardingSurvey" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "PropertyOnboardingSurvey_organizationId_idx" ON "PropertyOnboardingSurvey"("organizationId");
ALTER TABLE "PropertyOnboardingSurvey" ADD CONSTRAINT "PropertyOnboardingSurvey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OnboardingAppliance" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "OnboardingAppliance_organizationId_idx" ON "OnboardingAppliance"("organizationId");
ALTER TABLE "OnboardingAppliance" ADD CONSTRAINT "OnboardingAppliance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OnboardingSpecialRequest" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "OnboardingSpecialRequest_organizationId_idx" ON "OnboardingSpecialRequest"("organizationId");
ALTER TABLE "OnboardingSpecialRequest" ADD CONSTRAINT "OnboardingSpecialRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OnboardingLaundryDetail" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "OnboardingLaundryDetail_organizationId_idx" ON "OnboardingLaundryDetail"("organizationId");
ALTER TABLE "OnboardingLaundryDetail" ADD CONSTRAINT "OnboardingLaundryDetail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OnboardingAccessDetail" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "OnboardingAccessDetail_organizationId_idx" ON "OnboardingAccessDetail"("organizationId");
ALTER TABLE "OnboardingAccessDetail" ADD CONSTRAINT "OnboardingAccessDetail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OnboardingJobTypeAnswer" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "OnboardingJobTypeAnswer_organizationId_idx" ON "OnboardingJobTypeAnswer"("organizationId");
ALTER TABLE "OnboardingJobTypeAnswer" ADD CONSTRAINT "OnboardingJobTypeAnswer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Integration_organizationId_idx" ON "Integration"("organizationId");
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IcalSyncRun" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "IcalSyncRun_organizationId_idx" ON "IcalSyncRun"("organizationId");
ALTER TABLE "IcalSyncRun" ADD CONSTRAINT "IcalSyncRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "XeroConnection" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "XeroConnection_organizationId_idx" ON "XeroConnection"("organizationId");
ALTER TABLE "XeroConnection" ADD CONSTRAINT "XeroConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppSetting" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "AppSetting_organizationId_idx" ON "AppSetting"("organizationId");
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UploadFailure" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "UploadFailure_organizationId_idx" ON "UploadFailure"("organizationId");
ALTER TABLE "UploadFailure" ADD CONSTRAINT "UploadFailure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeocodeFailure" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "GeocodeFailure_organizationId_idx" ON "GeocodeFailure"("organizationId");
ALTER TABLE "GeocodeFailure" ADD CONSTRAINT "GeocodeFailure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
