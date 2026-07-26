-- Marketing analytics: Resend webhook telemetry per campaign recipient.
-- Additive only — no existing column is altered or dropped.

-- Link a per-recipient send back to the provider message id so an incoming
-- webhook event (which only knows Resend's email_id) can find its campaign.
ALTER TABLE "CampaignSend" ADD COLUMN "externalId" TEXT;
CREATE INDEX "CampaignSend_externalId_idx" ON "CampaignSend"("externalId");

-- Append-only event log. type: DELIVERED | OPENED | CLICKED | BOUNCED |
-- COMPLAINED | DELAYED | SENT
CREATE TABLE "EmailCampaignEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCampaignEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailCampaignEvent_campaignId_idx" ON "EmailCampaignEvent"("campaignId");
CREATE INDEX "EmailCampaignEvent_campaignId_type_idx" ON "EmailCampaignEvent"("campaignId", "type");
CREATE INDEX "EmailCampaignEvent_recipient_idx" ON "EmailCampaignEvent"("recipient");

ALTER TABLE "EmailCampaignEvent"
    ADD CONSTRAINT "EmailCampaignEvent_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
