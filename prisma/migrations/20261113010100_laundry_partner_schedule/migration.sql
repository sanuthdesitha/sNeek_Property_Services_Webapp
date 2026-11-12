-- Laundry partner pickup and drop schedule (2026-11-13). Descriptive defaults
-- only: the days of the week a partner usually collects / returns and its
-- usual time windows ("HH:mm", organisation time). They prefill the planned
-- TIME of a new run for that partner when no time is set and are shown to the
-- office; they never change a run's dates, the planner's date / turnaround
-- rules, exceptions or any existing run. Empty / null = nothing stated.
--
-- Weekdays use 0 = Sunday ... 6 = Saturday.
ALTER TABLE "LaundrySupplier" ADD COLUMN "pickupWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "LaundrySupplier" ADD COLUMN "pickupWindowStart" VARCHAR(5);
ALTER TABLE "LaundrySupplier" ADD COLUMN "pickupWindowEnd" VARCHAR(5);
ALTER TABLE "LaundrySupplier" ADD COLUMN "dropWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "LaundrySupplier" ADD COLUMN "dropWindowStart" VARCHAR(5);
ALTER TABLE "LaundrySupplier" ADD COLUMN "dropWindowEnd" VARCHAR(5);

ALTER TABLE "LaundrySupplier" ADD CONSTRAINT "LaundrySupplier_pickupWeekdays_range" CHECK ("pickupWeekdays" <@ ARRAY[0,1,2,3,4,5,6]::INTEGER[]);
ALTER TABLE "LaundrySupplier" ADD CONSTRAINT "LaundrySupplier_dropWeekdays_range" CHECK ("dropWeekdays" <@ ARRAY[0,1,2,3,4,5,6]::INTEGER[]);
ALTER TABLE "LaundrySupplier" ADD CONSTRAINT "LaundrySupplier_pickupWindowStart_format" CHECK ("pickupWindowStart" IS NULL OR "pickupWindowStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "LaundrySupplier" ADD CONSTRAINT "LaundrySupplier_pickupWindowEnd_format" CHECK ("pickupWindowEnd" IS NULL OR "pickupWindowEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "LaundrySupplier" ADD CONSTRAINT "LaundrySupplier_dropWindowStart_format" CHECK ("dropWindowStart" IS NULL OR "dropWindowStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "LaundrySupplier" ADD CONSTRAINT "LaundrySupplier_dropWindowEnd_format" CHECK ("dropWindowEnd" IS NULL OR "dropWindowEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
