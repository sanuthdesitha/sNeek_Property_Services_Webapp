import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/cleaner/fixtures/evidence-browser-entry.ts")],
    bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd() },
  })).outputFiles[0].text;
});

class EvidenceFixturePage {
  constructor(readonly page: Page) {}
  async open() { await this.page.goto("/__synthetic_evidence_recovery"); await this.page.addScriptTag({ content: bundle }); }
  capture() { return this.page.evaluate(() => (window as any).__evidenceFixture.capture()); }
  snapshot(): Promise<any[]> { return this.page.evaluate(() => (window as any).__evidenceFixture.snapshot()); }
  recover(id: string, scopePatch: Record<string, string> = {}) { return this.page.evaluate(({ id, scopePatch }) => (window as any).__evidenceFixture.recover(id, scopePatch), { id, scopePatch }); }
  failStorage(phase: "original" | "receipt") { return this.page.evaluate(phase => (window as any).__evidenceFixture.failStorage(phase), phase); }
}

async function mockTransport(context: BrowserContext, page: Page, options: { loseCompletion?: boolean; missingObject?: boolean; loseAttachment?: boolean } = {}) {
  const counts = { allocate: 0, part: 0, complete: 0, attach: 0, abort: 0 };
  const remote = new Set<string>(); const attachments = new Set<string>();
  await context.route("**/__synthetic_evidence_recovery", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><head><title>Evidence recovery fixture</title></head><body><h1>Evidence recovery fixture</h1></body></html>" }));
  await context.route("**/api/uploads/presign-multipart", async route => {
    counts.allocate++;
    const input = route.request().postDataJSON();
    const key = `${input.folder}/synthetic-actor/proof.pdf`;
    await route.fulfill({ json: { key, uploadId: "synthetic-upload", partUrls: [`${new URL(route.request().url()).origin}/__synthetic_part/${input.folder.split("/")[2]}`] } });
  });
  await context.route("**/__synthetic_part/*", async route => {
    counts.part++;
    // Read the real IndexedDB while the part request is paused. Both identity
    // fields must already be committed before any transport is permitted.
    const rows = await new EvidenceFixturePage(page).snapshot();
    expect(rows[0].allocation).toMatchObject({ uploadId: "synthetic-upload", key: expect.stringContaining(rows[0].id) });
    expect(rows[0].status).toBe("uploading");
    await route.fulfill({ status: 200, headers: { etag: '"synthetic-part"' }, body: "" });
  });
  await context.route("**/api/uploads/complete-multipart", async route => {
    counts.complete++; const { key } = route.request().postDataJSON();
    if (!options.missingObject) remote.add(key);
    if (options.loseCompletion) await route.abort("failed");
    else await route.fulfill({ json: { key, url: `/__synthetic_object/${encodeURIComponent(key)}` } });
  });
  await context.route("**/api/uploads/abort-multipart", async route => { counts.abort++; await route.fulfill({ json: { ok: true } }); });
  await context.route("**/api/cleaner/jobs/synthetic-job/evidence", async route => {
    counts.attach++; const body = route.request().postDataJSON();
    expect(body.key).toBe(`forms/synthetic-job/${body.captureId}/synthetic-actor/proof.pdf`);
    if (!remote.has(body.key)) { await route.fulfill({ status: 409, json: { error: "Uploaded evidence was not found. Keep the original and retry." } }); return; }
    attachments.add(body.captureId);
    if (options.loseAttachment && counts.attach === 1) await route.abort("failed");
    else await route.fulfill({ json: { ok: true, captureId: body.captureId, key: body.key,
      media: { key: body.key, url: `/__synthetic_object/${encodeURIComponent(body.key)}`, kind: "file", name: "proof.pdf" } } });
  });
  return { counts, attachments };
}

test("reload reconciles a remotely completed upload whose response was lost, without retransmitting", async ({ context, page }) => {
  const transport = await mockTransport(context, page, { loseCompletion: true });
  const fixture = new EvidenceFixturePage(page); await fixture.open();
  expect((await fixture.capture()).failures).toHaveLength(1);
  const before = (await fixture.snapshot())[0];
  expect(before.status).toBe("uploading"); expect(before.receipt).toBeUndefined();
  await fixture.open();
  expect((await fixture.recover(before.id)).failures).toEqual([]);
  const after = (await fixture.snapshot())[0];
  expect(after.status).toBe("attached"); expect(after.original).toContain("synthetic original evidence");
  expect(transport.counts).toMatchObject({ allocate: 1, part: 1, complete: 1, attach: 1 });
  expect(transport.attachments.size).toBe(1);
});

test("receipt-write quota failure survives reload through its committed allocation", async ({ context, page }) => {
  const transport = await mockTransport(context, page);
  const fixture = new EvidenceFixturePage(page); await fixture.open(); await fixture.failStorage("receipt");
  expect((await fixture.capture()).failures).toHaveLength(1);
  const before = (await fixture.snapshot())[0]; expect(before.status).toBe("uploading");
  await fixture.open();
  expect((await fixture.recover(before.id)).failures).toEqual([]);
  expect((await fixture.snapshot())[0].status).toBe("attached");
  expect(transport.counts).toMatchObject({ allocate: 1, part: 1, complete: 1, attach: 1 });
});

test("missing exact object stays pending with its original and never starts another upload", async ({ context, page }) => {
  const transport = await mockTransport(context, page, { loseCompletion: true, missingObject: true });
  const fixture = new EvidenceFixturePage(page); await fixture.open(); await fixture.capture();
  const before = (await fixture.snapshot())[0]; await fixture.open();
  expect((await fixture.recover(before.id)).failures[0].reason).toContain("not found");
  const after = (await fixture.snapshot())[0]; expect(after.status).toBe("uploading"); expect(after.original).toBe(before.original);
  expect(transport.counts).toMatchObject({ allocate: 1, part: 1, complete: 1, attach: 1 });
});

test("two tabs recovering a lost acknowledgement use one attachment retry", async ({ context, page }) => {
  const transport = await mockTransport(context, page, { loseAttachment: true });
  const fixture = new EvidenceFixturePage(page); await fixture.open(); await fixture.capture();
  const before = (await fixture.snapshot())[0]; expect(before.status).toBe("uploaded");
  const second = new EvidenceFixturePage(await context.newPage()); await fixture.open(); await second.open();
  const results = await Promise.all([fixture.recover(before.id), second.recover(before.id)]);
  expect(results.every(result => result.failures.length === 0)).toBe(true);
  expect(transport.counts).toMatchObject({ allocate: 1, part: 1, complete: 1, attach: 2 });
  expect(transport.attachments.size).toBe(1); await second.page.close();
});

test("changed actor or revision cannot recover another context's stored evidence", async ({ context, page }) => {
  const transport = await mockTransport(context, page, { loseCompletion: true });
  const fixture = new EvidenceFixturePage(page); await fixture.open(); await fixture.capture();
  const before = (await fixture.snapshot())[0]; await fixture.open();
  expect((await fixture.recover(before.id, { draftIdentity: "other-actor" })).failures[0].reason).toContain("older form");
  expect((await fixture.recover(before.id, { formRevision: "other-revision" })).failures[0].reason).toContain("older form");
  expect(transport.counts.attach).toBe(0); expect((await fixture.snapshot())[0].original).toBe(before.original);
});

test("failed original storage keeps the volatile File and dispatches no bytes", async ({ context, page }) => {
  const transport = await mockTransport(context, page);
  const fixture = new EvidenceFixturePage(page); await fixture.open(); await fixture.failStorage("original");
  const result = await fixture.capture(); expect(result.failures[0].reason).toContain("Not saved on this device");
  expect(await page.evaluate(() => (window as any).__evidenceFixture.retainedBeforeStorage())).toBe(1);
  expect(await fixture.snapshot()).toEqual([]);
  expect(await page.evaluate(() => (window as any).__evidenceFixture.volatileOriginal())).toContain("synthetic original evidence");
  await page.evaluate(() => (window as any).__evidenceFixture.mountRecovery());
  await expect(page.getByText("proof.pdf — Not saved on this device. Keep this page open.")).toBeVisible();
  await page.evaluate(() => { (window as any).__evidenceFixture.unmountRecovery(); (window as any).__evidenceFixture.mountRecovery(); });
  await expect(page.getByText("proof.pdf — Not saved on this device. Keep this page open.")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__evidenceFixture.volatileCount())).toBe(1);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save original", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("proof.pdf");
  await page.getByRole("button", { name: "I saved the original; remove from this page" }).click();
  expect(await page.evaluate(() => (window as any).__evidenceFixture.volatileCount())).toBe(0);
  expect(transport.counts).toMatchObject({ allocate: 0, part: 0, complete: 0, attach: 0 });
});

for (const destination of [{ type: "bulkPool" }, { type: "jobTask", taskId: "task" }, { type: "laundry" }, { type: "carryForwardNew" }]) {
  test(`reload preserves ${destination.type} destination through exact-key recovery`, async ({ context, page }) => {
    const transport = await mockTransport(context, page, { loseCompletion: true });
    const fixture = new EvidenceFixturePage(page); await fixture.open();
    await page.evaluate(destination => (window as any).__evidenceFixture.capture(destination), destination);
    const before = (await fixture.snapshot())[0]; expect(before.destination).toEqual(destination);
    await fixture.open(); expect((await fixture.recover(before.id)).failures).toEqual([]);
    expect((await fixture.snapshot())[0]).toMatchObject({ destination, status: "attached" });
    expect(transport.counts).toMatchObject({ allocate: 1, part: 1, complete: 1, attach: 1 });
  });
}
