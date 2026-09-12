import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftRecord } from "@/lib/uploads/draft-store";

// Event sequencing only: this harness does not emulate storage or commits.
function harness() {
  const requests: ReturnType<typeof opening>[] = [];
  function opening() {
    return {
      result: connection(), error: null as DOMException | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onblocked: null as (() => void) | null,
    };
  }
  function connection() {
    const transactions: ReturnType<typeof transaction>[] = [];
    return {
      close: vi.fn(),
      onclose: null as (() => void) | null,
      onversionchange: null as (() => void) | null,
      transactions,
      transaction: vi.fn(() => {
        const tx = transaction();
        transactions.push(tx);
        return tx;
      }),
    };
  }
  function transaction() {
    const request = {
      result: undefined as unknown, error: null as DOMException | null,
      onsuccess: null as (() => void) | null, onerror: null as (() => void) | null,
    };
    return {
      request, error: null as DOMException | null,
      oncomplete: null as (() => void) | null,
      onabort: null as (() => void) | null,
      onerror: null as (() => void) | null,
      abort: vi.fn(),
      objectStore: () => ({ put: () => request, delete: () => request, get: () => request, getAll: () => request }),
    };
  }
  const open = vi.fn(() => {
    const request = opening();
    requests.push(request);
    return request;
  });
  return { open, requests };
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

const record: DraftRecord = {
  id: "event-test", filename: "event.txt", size: 1, mime: "text/plain",
  uploadedAt: 1, blob: new Blob(["x"]), status: "pending", attempts: 0,
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("draft-store recovery event sequencing", () => {
  it.each(["async", "sync"])("retries a %s open failure and shares concurrent opens", async mode => {
    const fake = harness();
    vi.stubGlobal("indexedDB", fake);
    const store = await import("@/lib/uploads/draft-store");
    const error = new DOMException("Unavailable", "UnknownError");
    if (mode === "sync") fake.open.mockImplementationOnce(() => { throw error; });
    const failed = store.listDrafts();
    const rejection = expect(failed).rejects.toBe(error);
    if (mode === "async") {
      fake.requests[0].error = error;
      fake.requests[0].onerror!();
    }
    await rejection;
    const first = store.listDrafts();
    const second = store.getDraft("missing");
    expect(fake.open).toHaveBeenCalledTimes(2);
    const request = fake.requests.at(-1)!;
    request.onsuccess!();
    await flush();
    for (const tx of request.result.transactions) {
      tx.request.onsuccess!();
      tx.oncomplete!();
    }
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toBeNull();
  });

  it("rejects blocked opens, closes late success, and preserves the replacement cache", async () => {
    const fake = harness();
    vi.stubGlobal("indexedDB", fake);
    const store = await import("@/lib/uploads/draft-store");
    const failed = store.listDrafts();
    const rejection = expect(failed).rejects.toThrow("blocked");
    fake.requests[0].onblocked!();
    await rejection;
    const recovered = store.listDrafts();
    fake.requests[1].onsuccess!();
    fake.requests[0].onsuccess!();
    expect(fake.requests[0].result.close).toHaveBeenCalledOnce();
    await flush();
    fake.requests[1].result.transactions[0].oncomplete!();
    await recovered;
    const next = store.listDrafts();
    await flush();
    expect(fake.open).toHaveBeenCalledTimes(2);
    fake.requests[1].result.transactions[1].oncomplete!();
    await next;
  });

  it.each(["onversionchange", "onclose"] as const)("invalidates on %s without letting stale events clear a new connection", async event => {
    const fake = harness();
    vi.stubGlobal("indexedDB", fake);
    const store = await import("@/lib/uploads/draft-store");
    const first = store.listDrafts();
    const old = fake.requests[0].result;
    fake.requests[0].onsuccess!();
    await flush();
    old.transactions[0].oncomplete!();
    await first;
    old[event]!();
    if (event === "onversionchange") expect(old.close).toHaveBeenCalledOnce();
    const second = store.listDrafts();
    fake.requests[1].onsuccess!();
    old.onclose!();
    await flush();
    fake.requests[1].result.transactions[0].oncomplete!();
    await second;
    const third = store.listDrafts();
    await flush();
    expect(fake.open).toHaveBeenCalledTimes(2);
    fake.requests[1].result.transactions[1].oncomplete!();
    await third;
  });

  it.each(["saveDraft", "deleteDraft", "getDraft", "listDrafts"] as const)("%s waits for completion and rejects abort after request success", async operation => {
    const fake = harness();
    vi.stubGlobal("indexedDB", fake);
    const store = await import("@/lib/uploads/draft-store");
    const invoke = () => operation === "saveDraft" ? store.saveDraft(record)
      : operation === "listDrafts" ? store.listDrafts() : store[operation](record.id);
    const pending = invoke();
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const settled = vi.fn();
    void pending.then(settled, settled);
    fake.requests[0].onsuccess!();
    await flush();
    const tx = fake.requests[0].result.transactions[0];
    tx.request.onsuccess!();
    await flush();
    expect(settled).not.toHaveBeenCalled();
    tx.onabort!();
    await rejected;
    const retry = invoke();
    const completed = vi.fn();
    void retry.then(completed);
    await flush();
    const next = fake.requests[0].result.transactions[1];
    next.request.onsuccess!();
    await flush();
    expect(completed).not.toHaveBeenCalled();
    next.oncomplete!();
    await retry;
    expect(completed).toHaveBeenCalledOnce();
  });

  it("preserves request errors until abort and allows a cancelled error to complete", async () => {
    const fake = harness();
    vi.stubGlobal("indexedDB", fake);
    const store = await import("@/lib/uploads/draft-store");
    const pending = store.saveDraft(record);
    const error = new DOMException("Request failed", "ConstraintError");
    const rejected = expect(pending).rejects.toBe(error);
    fake.requests[0].onsuccess!();
    await flush();
    const tx = fake.requests[0].result.transactions[0];
    tx.request.error = error;
    tx.request.onerror!();
    tx.onerror!();
    tx.onabort!();
    await rejected;
    const retry = store.saveDraft(record);
    await flush();
    const next = fake.requests[0].result.transactions[1];
    next.request.error = error;
    next.request.onerror!();
    next.onerror!();
    next.oncomplete!();
    await expect(retry).resolves.toBeUndefined();
  });

  it("bounds closed-connection retries and leaves the next call able to recover", async () => {
    const fake = harness();
    vi.stubGlobal("indexedDB", fake);
    const store = await import("@/lib/uploads/draft-store");
    const error = new DOMException("Connection closed", "InvalidStateError");
    const pending = store.saveDraft(record);
    const rejected = expect(pending).rejects.toBe(error);
    for (let i = 0; i < 2; i++) {
      const request = fake.requests[i];
      request.result.transaction.mockImplementation(() => { throw error; });
      request.onsuccess!();
      await flush();
      expect(request.result.close).toHaveBeenCalledOnce();
    }
    await rejected;
    expect(fake.open).toHaveBeenCalledTimes(2);
    const retry = store.saveDraft(record);
    fake.requests[2].onsuccess!();
    await flush();
    fake.requests[2].result.transactions[0].oncomplete!();
    await retry;
  });

  it("rejects abort before request success with the transaction error, without replaying", async () => {
    const fake = harness();
    vi.stubGlobal("indexedDB", fake);
    const store = await import("@/lib/uploads/draft-store");
    const pending = store.getDraft(record.id);
    const error = new DOMException("Transaction failed", "UnknownError");
    const rejected = expect(pending).rejects.toBe(error);
    fake.requests[0].onsuccess!();
    await flush();
    const tx = fake.requests[0].result.transactions[0];
    tx.error = error;
    tx.onabort!();
    await rejected;
    expect(fake.open).toHaveBeenCalledOnce();
    expect(fake.requests[0].result.transaction).toHaveBeenCalledOnce();
  });
});
