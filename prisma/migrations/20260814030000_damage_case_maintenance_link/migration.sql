-- CP-7 — link a maintenance item back to the DAMAGE case that spawned it.
--
-- Without this link the two records drift: a client can see a closed damage
-- case sitting beside a repair that is still open (or the reverse). The link is
-- what lets a status change on either side carry to the other.
--
-- Additive and nullable. Existing items keep NULL, meaning "raised directly"
-- (a cleaner, QA or admin report rather than a damage case).
-- ON DELETE SET NULL: deleting a case must orphan the repair, never delete it —
-- the physical damage does not stop existing because the paperwork was removed.
ALTER TABLE "PropertyMaintenanceItem" ADD COLUMN "caseId" TEXT;

CREATE INDEX "PropertyMaintenanceItem_caseId_idx"
    ON "PropertyMaintenanceItem"("caseId");

ALTER TABLE "PropertyMaintenanceItem"
    ADD CONSTRAINT "PropertyMaintenanceItem_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "IssueTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
