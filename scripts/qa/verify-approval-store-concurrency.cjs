const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const ts = require("typescript");
const { PrismaClient } = require("@prisma/client");

require("@next/env").loadEnvConfig(process.cwd());
const url = new URL(process.env.DATABASE_URL || "http://missing.invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^postgres(ql)?:$/.test(url.protocol)) {
  throw new Error("This check requires an explicitly local PostgreSQL DATABASE_URL.");
}

const key = `qa:client-approvals:${randomUUID()}`;
const realDb = new PrismaClient();
function scopedClient(client) {
  return {
    appSetting: {
      findUnique: args => client.appSetting.findUnique({ ...args, where: { key } }),
      upsert: args => client.appSetting.upsert({ ...args, where: { key }, create: { ...args.create, key } }),
    },
    $executeRaw: (parts, ...values) => client.$executeRaw(parts, ...values.map(value => value === "client_approvals_v1" ? key : value)),
  };
}
const isolatedDb = {
  ...scopedClient(realDb),
  $transaction: (run, options) => realDb.$transaction(tx => run(scopedClient(tx)), options),
};

// Execute the real module; only its database key/lock namespace is redirected.
const sourcePath = path.resolve("lib/commercial/client-approvals.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleValue = { exports: {} };
const localRequire = createRequire(sourcePath);
new Function("require", "module", "exports", compiled)(
  name => name === "@/lib/db" ? { db: isolatedDb } : localRequire(name),
  moduleValue, moduleValue.exports,
);
const approvals = moduleValue.exports;

async function main() {
  try {
    const input = { clientId: "qa-client", title: "QA only", description: "Isolated concurrency check", amount: 50, requestedByUserId: "qa-admin" };
    const [first, second] = await Promise.all([
      approvals.createClientApproval(input), approvals.createClientApproval(input),
    ]);
    assert.equal((await approvals.listClientApprovals()).length, 2, "parallel creates must both survive");
    await Promise.all([
      approvals.updateClientApprovalById(first.id, { description: "First updated" }),
      approvals.updateClientApprovalById(second.id, { description: "Second updated" }),
    ]);
    const pending = await approvals.getClientApprovalById(first.id);
    const expectedVersion = approvals.clientApprovalVersion?.(pending);
    const results = await Promise.allSettled([
      approvals.respondClientApproval({ id: first.id, clientId: "qa-client", decision: "APPROVE", respondedByUserId: "qa-user", expectedVersion }),
      approvals.counterClientApproval({ id: first.id, clientId: "qa-client", amount: 40, counteredByUserId: "qa-user", expectedVersion }),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1, "only one competing decision may commit");
    const rows = await approvals.listClientApprovals();
    assert.equal(rows.length, 2);
    assert.equal(rows.find(row => row.id === second.id).description, "Second updated");
    assert.equal(rows.find(row => row.id === first.id).description, "First updated");
    console.log("PASS: real PostgreSQL parallel creates/updates and competing approval decisions; application history untouched.");
  } finally {
    try {
      assert.match(key, /^qa:client-approvals:[a-f0-9-]{36}$/);
      await realDb.appSetting.deleteMany({ where: { key } });
      console.log("QA setting removed.");
    } finally { await realDb.$disconnect(); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
