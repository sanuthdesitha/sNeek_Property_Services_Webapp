-- Key-lost mode per property
ALTER TABLE "Property" ADD COLUMN "keyLostMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Property" ADD COLUMN "keyLostSince" TIMESTAMP(3);

-- Driver day routes
CREATE TABLE "LaundryRoute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "stops" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaundryRoute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LaundryRoute_userId_date_idx" ON "LaundryRoute"("userId", "date");
CREATE INDEX "LaundryRoute_status_date_idx" ON "LaundryRoute"("status", "date");

ALTER TABLE "LaundryRoute" ADD CONSTRAINT "LaundryRoute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
