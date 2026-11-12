-- Quotes get a reference clients can see ("Q-204").
--
-- One whole number per quote, unique and never reused. Existing quotes are
-- numbered 1, 2, 3 ... in the order they were created (ties broken by id, so
-- the order is stable); nothing else about them changes. New quotes take the
-- next number from the "QUOTE" row of InvoiceSequence with the same single
-- atomic UPDATE ... RETURNING the invoice numbers use (lib/quotes/quote-number.ts),
-- so two quotes created at the same moment cannot share a number. The counter
-- only moves forward: a deleted quote's number is never issued again.

ALTER TABLE "Quote" ADD COLUMN "quoteNumber" INTEGER;

WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS n
  FROM "Quote"
)
UPDATE "Quote" AS q
   SET "quoteNumber" = ordered.n
  FROM ordered
 WHERE q."id" = ordered."id";

ALTER TABLE "Quote" ALTER COLUMN "quoteNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Quote_quoteNumber_key" ON "Quote"("quoteNumber");

-- The counter continues after the highest number just given out. If a QUOTE
-- row somehow exists already it is only ever moved forward.
INSERT INTO "InvoiceSequence" ("key", "prefix", "lastNumber", "padding", "updatedAt")
SELECT 'QUOTE', 'Q-', COALESCE(MAX("quoteNumber"), 0), 1, CURRENT_TIMESTAMP FROM "Quote"
ON CONFLICT ("key") DO UPDATE
   SET "lastNumber" = GREATEST("InvoiceSequence"."lastNumber", EXCLUDED."lastNumber"),
       "updatedAt" = CURRENT_TIMESTAMP;
