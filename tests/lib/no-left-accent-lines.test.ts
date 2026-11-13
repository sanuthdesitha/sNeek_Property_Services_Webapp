import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The owner replaced the coloured left-edge line on flagged cards, rows and
 * notices with the tinted title band (components/v2/ui/tone-band.tsx). This
 * scan fails if a left accent line comes back anywhere in the v2 app.
 *
 * Caught: thick left borders (`border-l-2` … `border-l-8`, `border-l-[3px]`),
 * coloured left borders (`border-l-[hsl(…)]`), inline `borderLeft*` styles,
 * inset left shadows (`shadow-[inset_3px_0_0_…]`) and CSS `border-left:`.
 * A plain 1px `border-l` (column divider) and `border-l-0` are layout, not
 * accents, and are not matched.
 */
const ROOT = process.cwd();
const SCAN_DIRS = ["components/v2", "app/v2"];

const ACCENT_PATTERNS: RegExp[] = [
  /border-l-(?:\[\d+px\]|[2-8])(?![\w-])/g,
  /border-l-\[(?:hsl|#|rgb|var)/g,
  /borderLeft(?:Color|Width|Style)?\s*:/g,
  /shadow-\[inset_\d+px_0_0/g,
  /border-left(?:-color|-width)?\s*:/g,
  // Logical-property spellings and the classic helper that sets one.
  /borderInlineStart(?:Color|Width|Style)?\s*:/g,
  /\bstatusBlockStyle\(/g,
  /JobStatusProgress\s+status=\{[^}]*\}\s*\/>/g,
];

/** Deliberate exceptions: file → exact snippet that must contain the match, and why. */
const ALLOWLIST: Array<{ file: string; snippet: string; reason: string }> = [
  {
    file: "components/v2/cleaner/form-renderer.tsx",
    snippet: 'border-l-2 border-[hsl(var(--e-border-strong))] pl-4',
    reason: "neutral nesting guide for follow-up questions, not a status accent",
  },
  {
    file: "components/v2/admin/maintenance/maintenance-detail.tsx",
    snippet: 'border-l-2 border-[hsl(var(--e-border))] pl-4',
    reason: "history timeline connector",
  },
  {
    file: "components/v2/admin/maintenance/maintenance-workspace.tsx",
    snippet: 'border-l-2 border-[hsl(var(--e-border))] pl-4',
    reason: "history timeline connector",
  },
  {
    file: "components/v2/laundry/handoff-receipts.tsx",
    snippet: 'border-l-2 border-[hsl(var(--e-border))] pl-3',
    reason: "handoff history timeline connector",
  },
  {
    file: "app/v2/(public)/blog/[slug]/page.tsx",
    snippet: 'border-l-2 border-[hsl(var(--e-gold))] pl-4',
    reason: "public blog lead quote styling",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(path);
  }
  return out;
}

function lineAllowed(file: string, line: string): boolean {
  return ALLOWLIST.some((entry) => entry.file === file && line.includes(entry.snippet));
}

describe("no coloured left accent lines in the v2 app", () => {
  it("finds no left accent line outside the documented exceptions", () => {
    const offences: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const path of walk(join(ROOT, dir))) {
        const file = relative(ROOT, path);
        readFileSync(path, "utf8")
          .split("\n")
          .forEach((line, index) => {
            const hit = ACCENT_PATTERNS.some((pattern) => {
              pattern.lastIndex = 0;
              return pattern.test(line);
            });
            if (hit && !lineAllowed(file, line)) offences.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
          });
      }
    }
    expect(offences).toEqual([]);
  });

  it("every allowlist entry still exists (remove entries once converted)", () => {
    const stale = ALLOWLIST.filter((entry) => !readFileSync(join(ROOT, entry.file), "utf8").includes(entry.snippet));
    expect(stale.map((entry) => entry.file)).toEqual([]);
  });
});
