CREATE TABLE "LaundryQuantityException" (
 "id" TEXT NOT NULL, "laundryTaskId" TEXT, "originalTaskId" TEXT NOT NULL, "propertyId" TEXT NOT NULL, "jobId" TEXT NOT NULL, "pickupConfirmationId" TEXT NOT NULL,
 "unit" TEXT NOT NULL DEFAULT 'bags', "expectedCount" INTEGER NOT NULL, "actualCount" INTEGER NOT NULL,
 "baseline" JSONB NOT NULL, "reason" TEXT NOT NULL, "photoKey" TEXT NOT NULL, "photoUrl" TEXT NOT NULL,
 "reportedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "resolvedAt" TIMESTAMP(3), "resolvedById" TEXT, "resolutionNote" TEXT, "version" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "LaundryQuantityException_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "LaundryQuantityException_laundryTaskId_fkey" FOREIGN KEY ("laundryTaskId") REFERENCES "LaundryTask"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LaundryQuantityException_pickupConfirmationId_key" ON "LaundryQuantityException"("pickupConfirmationId");
CREATE INDEX "LaundryQuantityException_resolvedAt_createdAt_id_idx" ON "LaundryQuantityException"("resolvedAt", "createdAt", "id");
