// @vitest-environment node
/**
 * No email body is built as HTML outside lib/email-design (owner: "no more
 * hard coded designs, all editable"). Fails when a file that hands content to
 * an email sender (sendEmailDetailed, sendEmail, an office send's `email:`,
 * a pipeline `emailHtml`, wrapEmailHtml) also writes HTML tags in code.
 *
 * The allowlist is explicit and short, each with its reason. A file there
 * may only build DATA fragments passed as a "built" value of a block design
 * (an escaped list or table of records), a document attached as a PDF, or
 * mail a person wrote; never an email's wording or layout.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN = ["app", "lib", "workers"];
const SENDER = /\bsendEmailDetailed\s*\(|\bsendEmail\s*\(|\bemailHtml\s*:|\bwrapEmailHtml\s*\(|\bemail\s*:\s*(?:\(|async\b)/;
const HTML_IN_CODE = /[`"'][^`"'\n]*<(?:p|div|table|tr|td|th|h[1-6]|ul|ol|li|strong|br|html|body|a\s)[\s>/][^`"'\n]*[`"']/i;

/** file → why it may still write HTML. Keep this short. */
const ALLOWLIST: Record<string, string> = {
  "lib/ops/tomorrow-prep.ts": "built data: tomorrow's job, laundry and stock lists (escaped) for the summary designs",
  "lib/ops/admin-attention-summary.ts": "built data: the attention breakdown list for adminAttentionSummary",
  "lib/email-templates.ts": "standard raw templates kept only to detect an admin's earlier custom HTML; renders through lib/email-design",
  "lib/ical/notifications.ts": "built data: changed-job and warning lists for the iCal alert design",
  "lib/workforce/service.ts": "built data: credential and document lists for workforce designs",
  "lib/inventory/client-shopping-notifications.ts": "built data: purchase breakdown and receipt links for the shopping design",
  "app/api/admin/jobs/[id]/quote-extras/route.ts": "built data: added and removed add-on rows for the booking-updated design",
  "app/api/admin/messages/send/route.ts": "composed by a person (office message composer)",
  "app/api/admin/notifications/test/route.ts": "provider diagnostic test, fixed on purpose",
  "lib/notifications/test-send.ts": "provider diagnostic test, fixed on purpose",
  "app/api/admin/va-invites/route.ts": "built data: the list of assistants added (escaped) for the assistants-added design",
  "app/api/public/quote-view/[token]/request-addon/route.ts": "built data: the add-ons asked for (escaped) for the add-on alert design",
  "lib/cleaner/invoice-admin-notify.ts": "built data: the cleaner's escaped note with line breaks for the change-request design",
  "lib/notifications/client-automation.ts": "built data: an automation rule's text with line breaks for the rule-email design",
  "lib/notifications/lifecycle.ts": "the plain body kept for the reassign dialog and New job preview; sends the lifecycle design",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

function offenders(): string[] {
  return SCAN.flatMap((dir) => files(join(ROOT, dir)))
    .map((path) => relative(ROOT, path).split("\\").join("/"))
    .filter((file) => !file.startsWith("lib/email-design/") && !file.startsWith("lib/notifications/wording/") && !file.endsWith(".tsx"))
    .filter((file) => {
      const text = readFileSync(join(ROOT, file), "utf8");
      return SENDER.test(text) && HTML_IN_CODE.test(text);
    });
}

describe("email HTML is built only by the email design system", () => {
  it("no file outside lib/email-design hands hand-written HTML to an email sender (except the allowlist)", () => {
    expect(offenders().filter((file) => !ALLOWLIST[file])).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const found = new Set(offenders());
    expect(Object.keys(ALLOWLIST).filter((file) => !found.has(file))).toEqual([]);
  });
});
