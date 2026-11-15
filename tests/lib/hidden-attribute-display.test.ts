/**
 * The `hidden` attribute and a display utility on the same element (2026-11-17).
 *
 * `hidden={...}` next to `className="flex ..."` does not hide: the utility's
 * `display` wins over the browser's `[hidden]` rule. That left every visited tab
 * on the person page on screen, so choosing a tab looked like it did nothing.
 * Two guards: the Estate stylesheet forces `[hidden]` to hide, and components
 * that pair `hidden` with a literal display class on one line are refused.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

const DISPLAY_CLASS = /\b(flex|grid|block|inline-flex|inline-block|inline-grid|contents)\b/;
const HIDDEN_WITH_LITERAL_CLASS = /hidden=\{[^}]+\}[^>]*className="([^"]*)"/;

describe("the hidden attribute always hides", () => {
  it("is enforced by the Estate stylesheet", () => {
    const css = readFileSync("app/v2/estate.css", "utf8");
    expect(css).toMatch(/\[hidden\]:not\(\[hidden="until-found"\]\)\s*\{\s*display:\s*none\s*!important;\s*\}/);
  });

  it("is never paired with a fixed display class on the same element", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles("components/v2"), ...sourceFiles("app/v2")]) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        const match = HIDDEN_WITH_LITERAL_CLASS.exec(line);
        if (match && DISPLAY_CLASS.test(match[1])) offenders.push(`${file}:${index + 1}`);
      });
    }
    expect(offenders, "Switch the display class with the same condition as `hidden` (e.g. cn(open ? \"flex\" : \"hidden\")).").toEqual([]);
  });
});
