CREATE SEQUENCE "Job_jobNumber_seq"
    START WITH 1000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE "Job"
ADD COLUMN "jobNumber" TEXT;

UPDATE "Job"
SET "jobNumber" = 'JOB-' || LPAD(nextval('"Job_jobNumber_seq"')::text, 6, '0')
WHERE "jobNumber" IS NULL;

ALTER TABLE "Job"
ALTER COLUMN "jobNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Job_jobNumber_key" ON "Job"("jobNumber");
