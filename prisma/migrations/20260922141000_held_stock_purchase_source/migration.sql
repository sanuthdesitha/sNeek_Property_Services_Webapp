ALTER TABLE "HeldStock" ADD COLUMN "shoppingRunLineId" TEXT;
CREATE INDEX "HeldStock_shoppingRunLineId_idx" ON "HeldStock"("shoppingRunLineId");
ALTER TABLE "HeldStock" ADD CONSTRAINT "HeldStock_shoppingRunLineId_fkey" FOREIGN KEY ("shoppingRunLineId") REFERENCES "ShoppingRunLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
