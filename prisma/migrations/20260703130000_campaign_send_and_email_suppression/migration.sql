-- Two additive tables (no changes to existing data):
--   1. CampaignSend     — per-recipient send ledger so a crashed/retried
--      campaign dispatch never re-emails someone already contacted.
--   2. EmailSuppression — channel-independent suppression keyed on the address,
--      so unsubscribes/complaints for client emails without a User row are honoured.

-- CreateTable
CREATE TABLE "CampaignSend" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignSend_campaignId_idx" ON "CampaignSend"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSend_campaignId_email_key" ON "CampaignSend"("campaignId", "email");

-- AddForeignKey
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_email_key" ON "EmailSuppression"("email");

-- CreateIndex
CREATE INDEX "EmailSuppression_email_idx" ON "EmailSuppression"("email");
