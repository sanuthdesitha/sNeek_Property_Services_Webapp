ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "frequency" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "serviceAddress" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "serviceSuburb" TEXT;

CREATE TABLE IF NOT EXISTS "QuoteEvent" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "QuoteEvent_quoteId_idx" ON "QuoteEvent"("quoteId");
CREATE INDEX IF NOT EXISTS "QuoteEvent_createdAt_idx" ON "QuoteEvent"("createdAt");
DO $$ BEGIN
  ALTER TABLE "QuoteEvent" ADD CONSTRAINT "QuoteEvent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
