const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const ts = require("typescript");
const { PrismaClient } = require("@prisma/client");
const url = new URL(process.env.DATABASE_URL || "http://missing.invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^postgres(ql)?:$/.test(url.protocol)) throw new Error("Explicit local PostgreSQL is required.");
const db = new PrismaClient();
const key = `qa-bulk-${randomUUID()}`;
const ids = [`${key}-a`, `${key}-b`];
const modules = new Map();
function load(file) {
  const source = path.resolve(file); if (modules.has(source)) return modules.get(source);
  const compiled = ts.transpileModule(fs.readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} }; const localRequire = createRequire(source);
  new Function("require", "module", "exports", compiled)(name => name === "server-only" ? {} : name === "@/lib/db" ? { db } : name === "./bulk-status" ? load("lib/jobs/bulk-status.ts") : localRequire(name), mod, mod.exports);
  modules.set(source, mod.exports); return mod.exports;
}
const service = load("lib/jobs/bulk-status-store.ts");
async function main() {
  let releaseInvoice;
  let invoice;
  try {
    await db.user.create({ data: { id: key, email: `${key}@example.invalid`, role: "ADMIN", name: "Bulk status verification" } });
    await db.client.create({ data: { id: key, name: "Bulk status verification" } });
    await db.property.create({ data: { id: key, clientId: key, name: "Synthetic property", address: "Synthetic only", suburb: "Sydney" } });
    await db.job.createMany({ data: ids.map(id => ({ id, jobNumber: id, propertyId: key, jobType: "GENERAL_CLEAN", scheduledDate: new Date("2026-09-09T00:00:00Z"), status: "ASSIGNED" })) });
    const input = { jobIds: ids, status: "COMPLETED" };
    const preview = await service.previewBulkStatus(input);
    await service.applyBulkStatus(key, { ...input, reviewToken: preview.reviewToken });
    assert.equal(await db.job.count({ where: { id: { in: ids }, status: "COMPLETED", completedAt: { not: null } } }), 2);
    const stale = await service.previewBulkStatus({ jobIds: [ids[0]], status: "UNASSIGNED" });
    await db.jobAssignment.create({ data: { jobId: ids[0], userId: key } });
    await assert.rejects(service.applyBulkStatus(key, { jobIds: [ids[0]], status: "UNASSIGNED", reviewToken: stale.reviewToken }), error => error.status === 409);
    assert.equal(await db.jobAssignment.count({ where: { jobId: ids[0], removedAt: null } }), 1);
    await db.job.update({ where: { id: ids[1] }, data: { status: "INVOICED" } });
    await assert.rejects(service.applyBulkStatus(key, { jobIds: ids, status: "UNASSIGNED" }), error => error.status === 409);
    assert.equal((await db.job.findUnique({ where: { id: ids[0] } })).status, "COMPLETED");
    let locked;
    const lockReady = new Promise(resolve => { locked = resolve; });
    const release = new Promise(resolve => { releaseInvoice = resolve; });
    invoice = db.$transaction(async tx => { await tx.job.update({ where: { id: ids[0] }, data: { status: "INVOICED" } }); locked(); await release; }, { timeout: 15000 });
    await lockReady;
    const competing = service.applyBulkStatus(key, { jobIds: [ids[0]], status: "UNASSIGNED" }).then(value => ({ value }), error => ({ error }));
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      const rows = await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%SELECT id FROM "Job"%'`;
      waiting = rows.length > 0; if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true, "bulk update must wait for the invoicing row lock");
    releaseInvoice(); await invoice;
    const result = await competing; assert.equal(result.error?.status, 409, "concurrent invoicing must return confirmed conflict");
    assert.equal((await db.job.findUnique({ where: { id: ids[0] } })).status, "INVOICED");
    assert.equal(await db.auditLog.count({ where: { userId: key, action: "BULK_UPDATE_JOB_STATUS" } }), 2, "failed batches must not write audit successes");
    console.log("PASS: reviewed commit, stale assignment rejection, all-or-nothing invoiced block and real PostgreSQL invoicing lock race.");
  } finally {
    releaseInvoice?.(); if (invoice) await invoice.catch(() => {});
    await db.auditLog.deleteMany({ where: { userId: key, jobId: { in: ids } } });
    await db.jobAssignment.deleteMany({ where: { jobId: { in: ids } } });
    await db.job.deleteMany({ where: { id: { in: ids }, propertyId: key } });
    await db.property.deleteMany({ where: { id: key, clientId: key } });
    await db.client.deleteMany({ where: { id: key } });
    await db.user.deleteMany({ where: { id: key } });
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
