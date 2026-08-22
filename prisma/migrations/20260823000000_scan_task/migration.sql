-- Somebody has been asked to go and count a property.
--
-- Until now a stock count was something a cleaner had to decide to do: the
-- screen existed, but nothing ever pointed at it, so counts happened when
-- somebody happened to remember. This is the ASK — who, which property, by
-- when, and why — so it can surface in their Needs Attention list and be
-- chased when it does not happen.
--
-- Deliberately NOT a JobTask. A count is not work on a clean: it has no job,
-- and attaching it to one would make it inherit that job's lifecycle and
-- vanish the moment the clean was submitted.
--
-- `completedByCountAt` is stamped when a real count run follows, so "done" is
-- evidenced rather than asserted. A task ticked complete with no count behind
-- it is precisely the outcome this feature exists to prevent.
--
-- CASCADE on all three foreign keys: a task for a deleted property, or one
-- belonging to a deleted person, can never be actioned or reported on, and
-- leaving it behind would put an unreachable row in somebody's outstanding
-- list forever.

CREATE TABLE "ScanTask" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "instructions" TEXT,
    "dueAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedByCountAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanTask_pkey" PRIMARY KEY ("id")
);

-- Serves "what is outstanding for this person", which is the query the portal
-- runs on every page load.
CREATE INDEX "ScanTask_assigneeId_completedAt_idx" ON "ScanTask"("assigneeId", "completedAt");
CREATE INDEX "ScanTask_propertyId_idx" ON "ScanTask"("propertyId");

ALTER TABLE "ScanTask" ADD CONSTRAINT "ScanTask_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScanTask" ADD CONSTRAINT "ScanTask_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScanTask" ADD CONSTRAINT "ScanTask_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
