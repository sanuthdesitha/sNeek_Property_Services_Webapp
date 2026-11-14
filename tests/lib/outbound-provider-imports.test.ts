// @vitest-environment node
/**
 * No direct-send bypass: only the four transport chokepoints may talk to an
 * email, SMS or push provider, and each of them asks the sending safeguards
 * before its provider call. A file anywhere else that imports a provider
 * client or calls a provider's API fails this test.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCANNED = ["app", "lib", "workers", "components", "scripts"];

/** The only modules allowed to reach a provider. */
const TRANSPORT_MODULES: Record<string, RegExp> = {
  "lib/notifications/email.ts": /resend\.emails\.send\(/,
  "lib/notifications/sms.ts": /client\.messages\.create\(|fetch\(endpoint/,
  "lib/notifications/web-push.ts": /webpush\.sendNotification\(/,
  "lib/notifications/mobile-push.ts": /fetch\(EXPO_PUSH_API_URL/,
};

const PROVIDER_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Resend client", pattern: /from\s+["']resend["']|require\(\s*["']resend["']\s*\)/ },
  { name: "Twilio client", pattern: /from\s+["']twilio["']|require\(\s*["']twilio["']\s*\)/ },
  { name: "web-push client", pattern: /from\s+["']web-push["']|require\(\s*["']web-push["']\s*\)/ },
  { name: "nodemailer", pattern: /from\s+["']nodemailer["']|require\(\s*["']nodemailer["']\s*\)/ },
  { name: "Twilio REST API", pattern: /api\.twilio\.com/ },
  { name: "Resend REST API", pattern: /api\.resend\.com/ },
  { name: "Cellcast API", pattern: /cellcast\.com\.au\/api/ },
  { name: "Expo push API", pattern: /exp\.host\/--\/api\/v2\/push/ },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".") || name === "_stubs") continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx|js|cjs|mjs)$/.test(name) && !/\.(test|spec)\.[tj]sx?$/.test(name)) {
      out.push(relative(ROOT, path).split("\\").join("/"));
    }
  }
  return out;
}

const files = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)));

describe("outbound provider access", () => {
  it("is limited to the four transport chokepoints", () => {
    const offenders = files
      .filter((file) => !(file in TRANSPORT_MODULES))
      .flatMap((file) => {
        const text = readFileSync(join(ROOT, file), "utf8");
        return PROVIDER_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => `${file}: ${entry.name}`);
      });
    expect(offenders, "Send through lib/notifications/email.ts, sms.ts, web-push.ts or mobile-push.ts so the sending safeguards see it").toEqual([]);
    expect(files.length).toBeGreaterThan(500);
  });

  it("asks the sending safeguards before every provider call in each chokepoint", () => {
    for (const [file, providerCall] of Object.entries(TRANSPORT_MODULES)) {
      const text = readFileSync(join(ROOT, file), "utf8");
      expect(text, file).toMatch(/guardOutbound\(/);
      expect(text, file).toMatch(providerCall);
    }
  });
});
