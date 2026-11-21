// @vitest-environment node
/**
 * No send path can skip a person's (or client account's) own notification
 * switches (2026-11-21, after a client who switched notifications off kept
 * getting emails):
 * - each of the four provider modules asks the personal check before the
 *   sending safeguards and before its provider call;
 * - every inbox row passes the Prisma middleware that applies the switches;
 * - the shared delivery chokepoint and the pipeline's inbox delivery check too;
 * - opting a send out as "a person in the office deliberately sent this" is
 *   only allowed in the files listed here, each a send button. A new
 *   automatic sender that claims it fails this test until someone decides.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(relative(ROOT, full));
  }
  return out;
}

const PROVIDER_MODULES: Record<string, RegExp> = {
  "lib/notifications/email.ts": /resend\.emails\.send\(/,
  "lib/notifications/sms.ts": /const decision = await guardOutbound\(/,
  "lib/notifications/web-push.ts": /return guardOutbound\(/,
  "lib/notifications/mobile-push.ts": /const decision = await guardOutbound\(/,
};

/** Send buttons: a person writes or chooses the message and presses send. */
const OFFICE_DECISION_FILES = new Set([
  "app/api/admin/booking-requests/route.ts",
  "app/api/admin/client-approvals/route.ts",
  "app/api/admin/jobs/[id]/quote-extras/route.ts",
  "app/api/admin/messages/job/[jobId]/relay/route.ts",
  "app/api/admin/messages/job/[jobId]/route.ts",
  "app/api/admin/messages/route.ts",
  "app/api/admin/messages/send/route.ts",
  "app/api/admin/pay-adjustments/[id]/send-to-client/route.ts",
  "app/api/admin/qa/invites/route.ts",
  "app/api/admin/quotes/[id]/send/route.ts",
  "app/api/admin/reports/[jobId]/share/route.ts",
  "lib/billing/client-invoice-send.ts",
  "lib/notifications/documents.ts",
  "lib/notifications/external-recipient.ts",
  "lib/notifications/lifecycle.ts",
  // The mechanism itself.
  "lib/notifications/delivery.ts",
  "lib/notifications/personal/enforce.ts",
  "lib/notifications/personal/inbox-guard.ts",
  "lib/notifications/safeguards/gate.ts",
]);

describe("personal switches cannot be bypassed", () => {
  it("each provider module asks the personal check before the safeguards and the provider", () => {
    for (const [file, laterCall] of Object.entries(PROVIDER_MODULES)) {
      const source = read(file);
      const check = source.indexOf("checkPersonalSend(");
      expect(check, `${file} calls checkPersonalSend`).toBeGreaterThan(-1);
      const later = source.search(laterCall);
      expect(later, `${file} later call`).toBeGreaterThan(-1);
      expect(check, `${file}: personal check comes first`).toBeLessThan(later);
    }
    // Email: the personal switches run before the safeguards gate too.
    const email = read("lib/notifications/email.ts");
    expect(email.indexOf("applyPersonalSwitches(payload")).toBeLessThan(email.indexOf("applySendingSafeguards(payload, Array.isArray"));
  });

  it("every inbox row passes the switches in the Prisma middleware, before the phone-push marker", () => {
    const db = read("lib/db.ts");
    const switches = db.indexOf("applyPersonalInboxSwitches(params.args.data)");
    expect(switches).toBeGreaterThan(-1);
    expect(switches).toBeLessThan(db.indexOf("markMobileOutboxRows(params.args.data)"));
  });

  it("the shared delivery chokepoint, the pipeline inbox and client job updates check before writing", () => {
    expect(read("lib/notifications/delivery.ts")).toMatch(/personalInboxAllowed\(/);
    expect(read("lib/notifications/intent-store.ts")).toMatch(/personalInboxAllowed\(/);
    expect(read("lib/notifications/client-job-notifications.ts")).toMatch(/personalInboxAllowed\(/);
  });

  it("only send buttons may mark a send as a person's deliberate decision", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib")), ...sourceFiles(join(ROOT, "workers"))]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      if (/officeDecision:\s*(true|input\.)|writeDecidedInbox\(\s*"OFFICE_DECISION"/.test(source) && !OFFICE_DECISION_FILES.has(file)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the personal inbox never shows a row the switches stopped", () => {
    expect(read("lib/notifications/feed.ts")).toMatch(/NOT:\s*\{\s*status:\s*NotificationStatus\.FAILED,\s*errorMsg:\s*\{\s*in:\s*PERSONAL_SKIP_ERRORS/);
  });
});
