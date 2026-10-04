// @vitest-environment node
import { expect, it } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("requires explicit preference categories for every inline raw PUSH producer", () => {
  const root = join(__dirname, "../..");
  const files = ["lib", "app"].flatMap(dir => ts.sys.readDirectory(join(root, dir), [".ts", ".tsx"]));
  const missing: string[] = []; let checked = 0;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!/notification\.(create|createMany)/.test(source)) continue;
    // The dedicated adapter creates INBOX-only rows, never an implicit push.
    if (file.endsWith("/notifications/intent-store.ts")) continue;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node, producer = false) => {
      if (ts.isCallExpression(node) && /\.notification\.(create|createMany)$/.test(node.expression.getText(sf))) producer = true;
      if (producer && ts.isObjectLiteralExpression(node)) {
        const channel = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === "channel") as ts.PropertyAssignment | undefined;
        if (channel && /(?:"PUSH"|\.PUSH)$/.test(channel.initializer.getText(sf))) {
          checked++;
          const marker = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === "externalId") as ts.PropertyAssignment | undefined;
          if (!marker || !/mobilePendingMarker\(.+\)/.test(marker.initializer.getText(sf))) missing.push(`${file}:${sf.getLineAndCharacterOfPosition(node.pos).line + 1}`);
        }
      }
      ts.forEachChild(node, child => visit(child, producer));
    };
    visit(sf);
  }
  expect(checked).toBeGreaterThan(40); expect(missing).toEqual([]);
});
