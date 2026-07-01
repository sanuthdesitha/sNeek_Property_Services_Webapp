-- Key-handling evidence photos on laundry pickup + drop-off.
ALTER TABLE "LaundryTask" ADD COLUMN "pickupKeyPhotoUrl" TEXT;
ALTER TABLE "LaundryTask" ADD COLUMN "dropoffKeyPhotoUrl" TEXT;
