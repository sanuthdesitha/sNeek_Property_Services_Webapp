-- Enable supply tracking on every ACTIVE property (owner decision, 2026-08).
--
-- `Property.inventoryEnabled` defaults to false, so properties added since the
-- inventory hub shipped never opted in — which is why a cleaner's supplies
-- screen showed a fraction of the places they actually work, and why restock
-- and shopping plans skipped them silently.
--
-- The flag is KEPT rather than dropped: it stays the per-property opt-OUT for
-- somewhere that genuinely does not track stock. This backfill only changes
-- properties that are currently active; retired ones are left as they are.
UPDATE "Property"
SET "inventoryEnabled" = true
WHERE "isActive" = true
  AND "inventoryEnabled" = false;
