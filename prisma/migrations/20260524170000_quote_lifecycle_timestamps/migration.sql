-- Quote lifecycle timestamps: viewedAt / acceptedAt / declinedAt
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "declinedAt" TIMESTAMP(3);
