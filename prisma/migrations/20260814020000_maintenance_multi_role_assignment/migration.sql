-- CP-6 — multi-role assignment on a maintenance item.
--
-- A maintenance item is rarely one person's job: a trade fixes it, a cleaner
-- tidies after, a QA inspector signs it off. One row here is one PERSON in one
-- ROLE, so the three roles stay separately addressable in the admin UI and each
-- person's portal can gate its maintenance section on "am I on this item?".
--
-- Additive only. The legacy single-assignee column
-- PropertyMaintenanceItem."assignedWorkerId" is deliberately left alone — it
-- still drives the ad-hoc trade's visit lifecycle (en route → clock out).
--
-- Follows the JobAssignment convention: rows are never deleted, they are
-- stamped "removedAt" (NULL = active) so un-assigning keeps the history.

CREATE TYPE "MaintenanceAssigneeRole" AS ENUM ('MAINTENANCE', 'CLEANER', 'QA');

CREATE TABLE "MaintenanceItemAssignment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MaintenanceAssigneeRole" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "MaintenanceItemAssignment_pkey" PRIMARY KEY ("id")
);

-- One person may hold at most one row per role on an item; re-assigning after a
-- removal reuses the row (removedAt back to NULL) rather than piling up dupes.
CREATE UNIQUE INDEX "MaintenanceItemAssignment_itemId_userId_role_key"
    ON "MaintenanceItemAssignment"("itemId", "userId", "role");

-- Admin detail: "who is on this item, grouped by role".
CREATE INDEX "MaintenanceItemAssignment_itemId_role_idx"
    ON "MaintenanceItemAssignment"("itemId", "role");

-- Portal gating: "does this user have any active maintenance assignment?".
CREATE INDEX "MaintenanceItemAssignment_userId_removedAt_idx"
    ON "MaintenanceItemAssignment"("userId", "removedAt");

ALTER TABLE "MaintenanceItemAssignment"
    ADD CONSTRAINT "MaintenanceItemAssignment_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "PropertyMaintenanceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaintenanceItemAssignment"
    ADD CONSTRAINT "MaintenanceItemAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaintenanceItemAssignment"
    ADD CONSTRAINT "MaintenanceItemAssignment_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
