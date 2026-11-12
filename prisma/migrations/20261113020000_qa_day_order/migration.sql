-- Who set an inspector's visit order for a Sydney day, and whether the office
-- has locked it against the inspector's own reorder (lib/qa/day-order.ts).
-- The order itself stays in "QaAssignment"."sequence"; nothing existing changes.
CREATE TABLE "QaDayOrder" (
    "id" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "setByOffice" BOOLEAN NOT NULL DEFAULT false,
    "setById" TEXT,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedById" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaDayOrder_pkey" PRIMARY KEY ("id"),
    -- A lock is only ever placed by the office.
    CONSTRAINT "QaDayOrder_lock_is_office" CHECK (NOT "locked" OR "setByOffice")
);

CREATE UNIQUE INDEX "QaDayOrder_inspectorId_day_key" ON "QaDayOrder"("inspectorId", "day");

ALTER TABLE "QaDayOrder" ADD CONSTRAINT "QaDayOrder_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QaDayOrder" ADD CONSTRAINT "QaDayOrder_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QaDayOrder" ADD CONSTRAINT "QaDayOrder_unlockedById_fkey" FOREIGN KEY ("unlockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
