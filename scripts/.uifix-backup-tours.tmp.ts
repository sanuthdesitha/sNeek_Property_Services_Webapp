// Temporary fixture script (deleted after the walk-through).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const db = new PrismaClient();
const mode = process.argv[2];
async function main() {
  if (mode === "up") {
    await db.user.upsert({
      where: { email: "uifix-backup-admin@example.invalid" },
      create: { id: "uifix-backup-admin", email: "uifix-backup-admin@example.invalid", name: "Fixture Backup Admin", role: "ADMIN", isActive: true, passwordHash: await bcrypt.hash("FixtureAdmin123!", 10) },
      update: {},
    });
    const job = await db.job.findUniqueOrThrow({ where: { id: "demo-job-001" } });
    const { id: _id, jobNumber: _n, createdAt: _c, updatedAt: _u, reservationId: _r, ...rest } = job as any;
    await db.job.upsert({ where: { id: "uifix-qa-job" }, create: { ...rest, id: "uifix-qa-job", jobNumber: "JOB-UIFIX1", status: "COMPLETED", scheduledDate: new Date() }, update: {} });
    const qa = await db.user.findUniqueOrThrow({ where: { email: "qa@sneekproservices.com.au" } });
    await db.qaAssignment.upsert({ where: { id: "uifix-qa-assign" }, create: { id: "uifix-qa-assign", jobId: "uifix-qa-job", assignedToId: qa.id, status: "ASSIGNED", sequence: 1, scheduledFor: new Date(), checkInAt: new Date(Date.now() - 600000), checkInSkippedReason: null }, update: {} });
    await db.maintenanceItemAssignment.upsert({ where: { id: "uifix-maint-offer" }, create: { id: "uifix-maint-offer", itemId: "demo-maint-1", userId: "demo-maint-user", role: "MAINTENANCE", payType: "FIXED", payAmount: 120, payPayer: "SNEEK" }, update: {} });
  } else {
    await db.maintenanceItemAssignment.deleteMany({ where: { id: "uifix-maint-offer" } });
    await db.qaAssignment.deleteMany({ where: { jobId: "uifix-qa-job" } });
    await db.job.deleteMany({ where: { id: "uifix-qa-job" } });
  }
}
main().finally(() => db.$disconnect());
