const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const ts = require("typescript");
const { PrismaClient } = require("@prisma/client");

require("@next/env").loadEnvConfig(process.cwd());
const url = new URL(process.env.DATABASE_URL || "http://missing.invalid");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && /^postgres(ql)?:$/.test(url.protocol), "Local PostgreSQL required");
const db = new PrismaClient();
const sourcePath = path.resolve("lib/booking/idempotency.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)(createRequire(sourcePath), loaded, loaded.exports);
const { bookingIdentity, findBookingReplay, BookingKeyConflict } = loaded.exports;
const actor = `qa-${randomUUID()}`;
const payload = { propertyId: "qa-property", jobType: "GENERAL_CLEAN", scheduledDate: "2099-09-10", notes: "QA isolation" };
const identity = bookingIdentity(actor, "qa-client", randomUUID(), payload);
const rollbackIdentity = bookingIdentity(actor, "qa-client", randomUUID(), payload);
const ids = [identity.id, rollbackIdentity.id];
async function createOrReplay(input, rollback = false) {
  return db.$transaction(async tx => {
    const replay = await findBookingReplay(tx, input);
    if (replay) return { id: replay.id, replay: true };
    await tx.quoteLead.create({ data: {
      id: input.id, serviceType: "GENERAL_CLEAN", name: "QA booking retry", email: "qa@example.invalid",
      structuredContext: { bookingFingerprint: input.fingerprint, qa: true },
    } });
    if (rollback) throw new Error("QA rollback");
    return { id: input.id, replay: false };
  }, { maxWait: 10000, timeout: 10000 });
}
async function main() {
  try {
    assert.equal(await db.quoteLead.count({ where: { id: { in: ids } } }), 0);
    const results = await Promise.all(Array.from({ length: 5 }, () => createOrReplay(identity)));
    assert.equal(results.filter(row => !row.replay).length, 1);
    assert.equal(new Set(results.map(row => row.id)).size, 1);
    assert.equal(await db.quoteLead.count({ where: { id: identity.id } }), 1);
    await assert.rejects(createOrReplay({ ...identity, fingerprint: "changed" }), BookingKeyConflict);
    await assert.rejects(createOrReplay(rollbackIdentity, true), /QA rollback/);
    assert.equal(await db.quoteLead.count({ where: { id: rollbackIdentity.id } }), 0);
    assert.equal((await createOrReplay(rollbackIdentity)).replay, false);
    console.log("PASS: five concurrent attempts create one lead; conflicting payload rejected; rollback leaves retry available.");
  } finally {
    try {
      for (const id of ids) assert.match(id, /^booking_[a-f0-9]{64}$/);
      await db.quoteLead.deleteMany({ where: { id: { in: ids }, email: "qa@example.invalid" } });
      assert.equal(await db.quoteLead.count({ where: { id: { in: ids } } }), 0);
      console.log("Exact QA leads removed. No providers called.");
    } finally { await db.$disconnect(); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
