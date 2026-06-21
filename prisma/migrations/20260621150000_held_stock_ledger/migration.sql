-- On-hand stock ledger: stock held by a person (cleaner/client/QA) before it's
-- delivered to a unit, plus per-unit deliveries. Additive only.

CREATE TYPE "HeldStockStatus" AS ENUM ('HELD', 'DELIVERED', 'WRITTEN_OFF');

CREATE TABLE "HeldStock" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "holderUserId" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "originalQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unitCostAud" DOUBLE PRECISION,
  "status" "HeldStockStatus" NOT NULL DEFAULT 'HELD',
  "shoppingRunId" TEXT,
  "sourceNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HeldStock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HeldStock_holderUserId_status_idx" ON "HeldStock" ("holderUserId", "status");
CREATE INDEX "HeldStock_itemId_status_idx" ON "HeldStock" ("itemId", "status");

CREATE TABLE "HeldStockDelivery" (
  "id" TEXT NOT NULL,
  "heldStockId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "deliveredById" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HeldStockDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HeldStockDelivery_propertyId_createdAt_idx" ON "HeldStockDelivery" ("propertyId", "createdAt");
CREATE INDEX "HeldStockDelivery_heldStockId_idx" ON "HeldStockDelivery" ("heldStockId");

ALTER TABLE "HeldStock"
  ADD CONSTRAINT "HeldStock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HeldStock_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HeldStockDelivery"
  ADD CONSTRAINT "HeldStockDelivery_heldStockId_fkey" FOREIGN KEY ("heldStockId") REFERENCES "HeldStock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "HeldStockDelivery_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HeldStockDelivery_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
