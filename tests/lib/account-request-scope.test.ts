// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { bindAccountUrl, readAccountPath } from "@/lib/auth/account-request-scope";
const a = "a".repeat(32), b = "b".repeat(32);
describe("immutable account request scope", () => {
  it("rejects cross-account paths, malformed contexts and off-origin requests", () => {
    const bound = bindAccountUrl(a, "https://example.invalid");
    expect(bound("/api/jobs/job/form?q=1")).toBe(`/_accounts/${a}/api/jobs/job/form?q=1`);
    expect(() => bound(`/_accounts/${b}/api/uploads/direct`)).toThrow("another account");
    expect(() => bound("https://external.invalid/api")).toThrow("this origin");
    expect(readAccountPath(`/_accounts/${a}/%2f/admin`)).toBeNull();
    expect(readAccountPath(`/_accounts/${a}//api`)).toBeNull();
    expect(readAccountPath(`/_accounts/${a}/_accounts/${b}/api`)).toBeNull();
  });
  it("binds fetch, queued Request bodies, uploads, beacons and SSE before hydration; later tab changes cannot retarget them", async () => {
    const sent: any[] = [], upload: any[] = [], beacons: any[] = [], streams: any[] = [];
    const location = { pathname: `/_accounts/${a}/v2/cleaner`, href: `https://example.invalid/_accounts/${a}/v2/cleaner`, origin: "https://example.invalid" };
    const window: any = { fetch: vi.fn(async (...args: any[]) => { sent.push(args); return new Response("ok"); }), EventSource: class { constructor(url: string) { streams.push(url); } } };
    class XHR { open(...args: any[]) { upload.push(args); } }
    const navigator = { sendBeacon: (url: string, data: any) => { beacons.push([url, data]); return true; } };
    runInNewContext(readFileSync("public/account-context.js", "utf8"), { window, location, navigator, XMLHttpRequest: XHR, Request, URL, document: { addEventListener() {} } });
    const queued = new Request("https://example.invalid/api/jobs/job/draft", { method: "POST", body: "original evidence" });
    location.pathname = `/_accounts/${b}/v2/admin`; location.href = `https://example.invalid${location.pathname}`;
    await window.fetch(queued); new XHR().open("POST", "/api/uploads/direct"); navigator.sendBeacon("/api/cleaner/jobs/job/draft", "original"); new window.EventSource("/api/notifications/stream");
    expect(sent[0][0].url).toContain(`/_accounts/${a}/api/jobs/job/draft`);
    expect(await sent[0][0].text()).toBe("original evidence");
    expect(upload[0][1]).toContain(`/_accounts/${a}/api/uploads/direct`);
    expect(beacons[0][0]).toContain(`/_accounts/${a}/api/cleaner/jobs/job/draft`);
    expect(streams[0]).toContain(`/_accounts/${a}/api/notifications/stream`);
    expect(() => window.fetch(`/_accounts/${b}/api/admin/users`)).toThrow("another account");
    await window.fetch("https://storage.example.invalid/presigned-upload");
    expect(sent[1][0]).toBe("https://storage.example.invalid/presigned-upload");
  });
});
