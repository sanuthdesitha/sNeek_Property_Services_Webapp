-- Finance decisions (owner, 2026-11-11): per-client payment terms, the terms
-- snapshot on issued invoices, the "fully credited" marker used by the one
-- invoiced rule, and the one-off repair of legacy INVOICED jobs.
-- Additive columns only. No stored invoice line, total, number, status or
-- payment is changed. Re-running is a no-op (Prisma records the migration;
-- every UPDATE below is also guarded so a manual re-run changes nothing).

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "paymentTermsDays" INTEGER;

-- AlterTable
ALTER TABLE "ClientInvoice" ADD COLUMN     "creditedInFullAt" TIMESTAMP(3),
ADD COLUMN     "paymentTermsDays" INTEGER;

-- Bounds, enforced by the API too. Not modelled by Prisma, so never drift.
ALTER TABLE "Client" ADD CONSTRAINT "Client_paymentTermsDays_range_check"
  CHECK ("paymentTermsDays" IS NULL OR ("paymentTermsDays" BETWEEN 0 AND 120));
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_paymentTermsDays_range_check"
  CHECK ("paymentTermsDays" IS NULL OR ("paymentTermsDays" BETWEEN 0 AND 365));

-- 1. Terms snapshot for invoices already issued (sent, part paid, paid, void):
--    the CURRENT organisation default, read exactly as the app reads it
--    (settings.invoicing.defaultPaymentTermsDays, clamped 0..365, else 14), so
--    no issued document's due date moves. Left null (= live default, the same
--    date today) only if the configured default is not a whole number.
WITH org AS (
  SELECT CASE
    WHEN jsonb_typeof(s."value"::jsonb -> 'invoicing' -> 'defaultPaymentTermsDays') = 'number'
      THEN LEAST(365, GREATEST(0, (s."value"::jsonb -> 'invoicing' ->> 'defaultPaymentTermsDays')::numeric))
    ELSE NULL
  END AS days
  FROM "AppSetting" s WHERE s."key" = 'app'
), terms AS (
  SELECT COALESCE((SELECT days FROM org), 14::numeric) AS days
)
UPDATE "ClientInvoice" i
SET "paymentTermsDays" = (SELECT days FROM terms)::integer
WHERE i."paymentTermsDays" IS NULL
  AND i."status"::text IN ('SENT', 'PART_PAID', 'PAID', 'VOID')
  AND (SELECT days FROM terms) = TRUNC((SELECT days FROM terms));

-- 2. Fully credited marker: approved/sent credit notes cover the whole total
--    (creditedAmountOf + creditsCoverInvoice, half-cent tolerance).
UPDATE "ClientInvoice" i
SET "creditedInFullAt" = CURRENT_TIMESTAMP
FROM (
  SELECT c."creditsInvoiceId" AS id, SUM(ABS(c."totalAmount")) AS credited
  FROM "ClientInvoice" c
  WHERE c."kind" = 'CREDIT_NOTE' AND c."status"::text IN ('APPROVED', 'SENT')
  GROUP BY c."creditsInvoiceId"
) cr
WHERE cr.id = i."id"
  AND i."kind" = 'INVOICE'
  AND i."status"::text <> 'VOID'
  AND i."creditedInFullAt" IS NULL
  AND cr.credited > 0.005
  AND cr.credited + 0.005 >= i."totalAmount";

-- 3. Legacy repair: a job marked INVOICED with NO line on a live invoice
--    (kind INVOICE, not VOID, not fully credited) is not invoiced under the one
--    rule; it returns to COMPLETED, the only status from which the office
--    marks a job invoiced in practice. The ids and count are kept in
--    AppSetting "migration_20261112_legacy_invoiced_repair" for the record
--    (AuditLog needs a real user, and this is not any person's action).
WITH repaired AS (
  UPDATE "Job" j
  SET "status" = 'COMPLETED', "updatedAt" = CURRENT_TIMESTAMP
  WHERE j."status"::text = 'INVOICED'
    AND NOT EXISTS (
      SELECT 1 FROM "ClientInvoiceLine" l
      JOIN "ClientInvoice" i ON i."id" = l."invoiceId"
      WHERE l."jobId" = j."id"
        AND i."kind" = 'INVOICE'
        AND i."status"::text <> 'VOID'
        AND i."creditedInFullAt" IS NULL
    )
  RETURNING j."id"
)
INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
SELECT 'migration_20261112_legacy_invoiced_repair',
       jsonb_build_object(
         'count', COUNT(*),
         'jobIds', COALESCE(jsonb_agg(repaired."id"), '[]'::jsonb),
         'rule', 'INVOICED with no line on a live invoice -> COMPLETED'
       ),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM repaired
ON CONFLICT ("key") DO NOTHING;
