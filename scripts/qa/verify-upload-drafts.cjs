const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const ts = require("typescript");
const { chromium } = require("playwright");

const origin = new URL(process.env.SNEEK_QA_ORIGIN || "http://localhost:3010");
if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || origin.protocol !== "http:") {
  throw new Error("Upload draft QA requires a local HTTP development server.");
}
const source = fs.readFileSync(path.resolve(__dirname, "../../lib/uploads/draft-store.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

async function main() {
  const browser = await chromium.launch({ headless: true });
  // A fresh, nonpersistent context cannot access the user's browser drafts.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(new URL("/v2/login", origin).href, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const install = () => page.evaluate(code => {
      const module = { exports: {} };
      new Function("module", "exports", code)(module, module.exports);
      window.qaDraftStore = module.exports;
    }, compiled);
    await install();
    const id = `qa-draft-${randomUUID()}`;
    const first = await page.evaluate(async id => {
      const store = window.qaDraftStore;
      await store.saveDraft({ id, filename: "qa-evidence.txt", size: 11, mime: "text/plain",
        uploadedAt: Date.now(), blob: new Blob(["QA evidence"], { type: "text/plain" }), status: "pending", attempts: 0 });
      const draft = await store.getDraft(id);
      return { text: await draft.blob.text(), status: draft.status, count: (await store.listDrafts()).length };
    }, id);
    assert.deepEqual(first, { text: "QA evidence", status: "pending", count: 1 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await install();
    const restored = await page.evaluate(async id => {
      const store = window.qaDraftStore;
      const original = await store.getDraft(id);
      await store.saveDraft({ ...original, status: "failed", attempts: 1, error: "QA retry" });
      const updated = await store.getDraft(id);
      await store.deleteDraft(id);
      return { text: await updated.blob.text(), status: updated.status, attempts: updated.attempts,
        deleted: (await store.getDraft(id)) === null, remaining: (await store.listDrafts()).length };
    }, id);
    assert.deepEqual(restored, { text: "QA evidence", status: "failed", attempts: 1, deleted: true, remaining: 0 });
    const recovery = await page.evaluate(async ({ code, id }) => {
      const check = (value, message) => { if (!value) throw new Error(message); };
      const bounded = async promise => {
        let timer;
        try {
          return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Draft operation hung")), 5000);
          })]);
        } finally { clearTimeout(timer); }
      };
      const rejects = async (promise, name) => {
        try { await bounded(promise); } catch (error) {
          check(error.name === name, `Expected ${name}, got ${error.name}: ${error.message}`);
          return;
        }
        throw new Error(`Expected ${name} rejection`);
      };
      let connection;
      let fail = "async";
      let opens = 0;
      const factory = {
        open(...args) {
          opens++;
          if (fail === "sync") {
            fail = null;
            throw new DOMException("Controlled open failure", "SecurityError");
          }
          if (fail === "async") {
            fail = null;
            const request = { error: new DOMException("Controlled open failure", "UnknownError") };
            setTimeout(() => request.onerror(new Event("error")), 0);
            return request;
          }
          const request = indexedDB.open(...args);
          request.addEventListener("success", () => { connection = request.result; });
          return request;
        },
      };
      const load = () => {
        const module = { exports: {} };
        new Function("module", "exports", "indexedDB", code)(module, module.exports, factory);
        return module.exports;
      };
      let store = load();
      await rejects(store.listDrafts(), "UnknownError");
      check((await bounded(store.listDrafts())).length === 0 && opens === 2, "Async open recovery failed");
      connection.close();
      fail = "sync";
      store = load();
      await rejects(store.listDrafts(), "SecurityError");
      check((await bounded(store.listDrafts())).length === 0, "Sync open recovery failed");
      const beforeClose = opens;
      connection.close();
      await bounded(store.listDrafts());
      check(opens === beforeClose + 1, "Explicitly closed connection was not reopened");

      const record = { id, filename: "abort.txt", size: 8, mime: "text/plain", uploadedAt: Date.now(),
        blob: new Blob(["original"]), status: "pending", attempts: 0 };
      await bounded(store.saveDraft(record));
      // Abort a real transaction after request success, before native commit.
      // This checks both promise settlement and actual rollback of isolated records.
      for (const [method, operation] of [
        ["put", () => store.saveDraft({ ...record, attempts: 99 })],
        ["delete", () => store.deleteDraft(id)],
        ["get", () => store.getDraft(id)],
        ["getAll", () => store.listDrafts()],
      ]) {
        const original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function (...args) {
          const request = original.apply(this, args);
          request.addEventListener("success", () => this.transaction.abort(), { once: true });
          return request;
        };
        try { await rejects(operation(), "AbortError"); }
        finally { IDBObjectStore.prototype[method] = original; }
        const retained = await bounded(store.getDraft(id));
        check(retained.attempts === 0 && await retained.blob.text() === "original", `${method} abort changed record`);
      }
      await rejects(store.saveDraft({ ...record, uncloneable: () => {} }), "DataCloneError");
      await bounded(store.saveDraft({ ...record, attempts: 1 }));
      check((await bounded(store.getDraft(id))).attempts === 1, "Recovery after write failure failed");
      await bounded(store.deleteDraft(id));
      check((await bounded(store.listDrafts())).length === 0, "Recovery records were not removed");

      // The other loaded module also receives native versionchange and closes.
      await bounded(new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("sneek-uploads");
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Cached connection blocked database deletion"));
      }));
      const beforeVersionChange = opens;
      await bounded(store.saveDraft(record));
      check(opens === beforeVersionChange + 1, "Versionchange did not invalidate cached connection");
      check(await (await bounded(store.getDraft(id))).blob.text() === "original", "Recreated database lost blob");
      await bounded(store.deleteDraft(id));
      connection.close();
      return "open errors, closed connection, native abort rollback, clone failure, versionchange recovery";
    }, { code: compiled, id: `qa-recovery-${randomUUID()}` });
    console.log("PASS: real Chromium IndexedDB draft save/blob/reload/update/delete; isolated context only.");
    console.log(`PASS: ${recovery}.`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
