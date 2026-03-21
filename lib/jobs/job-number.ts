import { Prisma, PrismaClient } from "@prisma/client";

type JobNumberClient = PrismaClient | Prisma.TransactionClient;

const JOB_NUMBER_SEQUENCE_SQL = `SELECT nextval('"Job_jobNumber_seq"')::bigint AS value`;

export async function reserveJobNumber(client: JobNumberClient) {
  const rows = await client.$queryRawUnsafe<Array<{ value: bigint | number | string }>>(
    JOB_NUMBER_SEQUENCE_SQL
  );
  const rawValue = rows[0]?.value;
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error("Failed to reserve a job number.");
  }

  return `JOB-${String(Math.trunc(numericValue)).padStart(6, "0")}`;
}

export function getJobReference(job: { jobNumber?: string | null; id?: string | null }) {
  if (job.jobNumber?.trim()) return job.jobNumber.trim();
  if (job.id?.trim()) return `JOB-${job.id.trim().slice(-6).toUpperCase()}`;
  return "Job";
}
