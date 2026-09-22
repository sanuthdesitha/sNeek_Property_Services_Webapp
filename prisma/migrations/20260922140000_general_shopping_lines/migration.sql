-- General purchases belong to the cleaner until allocated to a property.
ALTER TABLE "ShoppingRunLine" ALTER COLUMN "propertyId" DROP NOT NULL;
