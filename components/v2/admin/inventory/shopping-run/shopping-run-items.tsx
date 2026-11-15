/**
 * The run's item lines, grouped by property, with each line's cost as the
 * buyer entered it. A bought line with no cost says "Not entered" (a tinted
 * leading cell with the reason, no left line), never $0.00; the totals row
 * says how many bought lines are costed. Display only.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { EPill } from "@/components/v2/ui/pill";
import { EToneRowCell, ETonePill, tonePhoneBandClass } from "@/components/v2/ui/tone-band";
import type { ShoppingCostCoverage } from "@/lib/inventory/shopping-line-cost";
import type { ShoppingRunLineView } from "@/lib/inventory/shopping-run-page";
import { aud, plural } from "../../pay-records/format";
import { MUTED, SMALL } from "../../pay-records/record-parts";

/** Lines on the list: included, or bought anyway. */
export function listedLines(lines: ShoppingRunLineView[]): ShoppingRunLineView[] {
  return lines.filter((line) => line.include || line.purchased);
}

function groupByProperty(lines: ShoppingRunLineView[]): Array<{ propertyId: string; propertyName: string; clientName: string | null; lines: ShoppingRunLineView[] }> {
  const groups = new Map<string, { propertyId: string; propertyName: string; clientName: string | null; lines: ShoppingRunLineView[] }>();
  for (const line of lines) {
    const group = groups.get(line.propertyId) ?? { propertyId: line.propertyId, propertyName: line.propertyName, clientName: line.clientName, lines: [] };
    group.lines.push(line);
    groups.set(line.propertyId, group);
  }
  return Array.from(groups.values());
}

function unitCostText(line: ShoppingRunLineView): string {
  if (line.cost.state === "not-bought") return "–";
  if (line.cost.state === "missing") return "Not entered";
  return line.cost.unitCost === null ? "–" : aud(line.cost.unitCost);
}

function lineCostText(line: ShoppingRunLineView): string {
  if (line.cost.state === "not-bought") return "–";
  if (line.cost.state === "missing") return "Not entered";
  return aud(line.cost.lineCost);
}

export function coverageText(coverage: ShoppingCostCoverage): string {
  return `${coverage.costedLines} of ${plural(coverage.boughtLines, "bought line")} costed`;
}

export function ShoppingItemsTable({ lines, coverage, actualTotal, ownerName }: { lines: ShoppingRunLineView[]; coverage: ShoppingCostCoverage; actualTotal: number; ownerName: string }) {
  const listed = listedLines(lines);
  const missing = coverage.boughtLines - coverage.costedLines;
  return (
    <div className="overflow-x-auto" role="region" aria-label="Item lines" tabIndex={0}>
      <table className="w-full min-w-[44rem] text-[0.875rem]">
        <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-[500]">Property · item</th>
            <th scope="col" className="px-3 py-2 text-right font-[500]">Planned</th>
            <th scope="col" className="px-3 py-2 text-right font-[500]">Bought</th>
            <th scope="col" className="px-3 py-2 text-right font-[500]">Unit cost</th>
            <th scope="col" className="px-3 py-2 text-right font-[500]">Line cost</th>
            <th scope="col" className="px-3 py-2 text-left font-[500]">State</th>
          </tr>
        </thead>
        <tbody>
          {listed.map((line) => {
            const missingCost = line.cost.state === "missing";
            const sub = [line.unit, line.clientName, line.note ? `"${line.note}"` : null].filter(Boolean).join(" · ");
            return (
              <tr key={line.key} className="border-t border-[hsl(var(--e-border))]">
                <EToneRowCell tone={missingCost ? "attention" : null} className="px-3 py-2">
                  <b>{line.propertyName}</b> · {line.itemName}
                  {missingCost ? <ETonePill tone="attention" className="ml-1.5 align-middle">No cost entered</ETonePill> : null}
                  {sub ? <p className={cn("text-[0.75rem]", MUTED)}>{sub}</p> : null}
                </EToneRowCell>
                <td className="e-tnum px-3 py-2 text-right">{line.include ? line.plannedQty : "–"}</td>
                <td className={cn("e-tnum px-3 py-2 text-right", !line.purchased && MUTED)}>{line.purchased ? line.boughtQty : "None"}</td>
                <td className={cn("e-tnum px-3 py-2 text-right", line.cost.state !== "costed" && MUTED, missingCost && "font-[600]")}>{unitCostText(line)}</td>
                <td className={cn("e-tnum px-3 py-2 text-right", line.cost.state !== "costed" && MUTED, missingCost && "font-[600]")}>{lineCostText(line)}</td>
                <td className="px-3 py-2">{line.purchased ? <EPill tone="ok">Bought</EPill> : <EPill>Not bought</EPill>}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-[hsl(var(--e-border-strong))]">
            <td colSpan={4} className="px-3 py-2">
              <b>Actual total</b>{" "}
              <span className={cn(SMALL, MUTED)}>
                · {plural(coverage.costedLines, "costed line")}
                {missing ? `; ${plural(missing, "bought line")} not costed` : ""}
              </span>
            </td>
            <td className="e-tnum px-3 py-2 text-right font-[600]">{aud(actualTotal)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <p className="sr-only">Costs as {ownerName} entered them.</p>
    </div>
  );
}

export function ShoppingItemsPhone({ lines }: { lines: ShoppingRunLineView[] }) {
  return (
    <div className="space-y-2.5">
      {groupByProperty(listedLines(lines)).map((group) => {
        const bought = group.lines.filter((line) => line.purchased);
        const notBought = group.lines.filter((line) => !line.purchased);
        return (
          <section key={group.propertyId} aria-label={group.propertyName} className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
            <div className="border-b border-[hsl(var(--e-border))] px-3 py-2">
              <b>{group.propertyName}</b>
              <p className={cn("text-[0.75rem]", MUTED)}>{[group.clientName, plural(group.lines.length, "line")].filter(Boolean).join(" · ")}</p>
            </div>
            <ul>
              {bought.map((line) => (
                <li key={line.key} className={cn("flex justify-between gap-3 px-3 py-1.5", SMALL, line.cost.state === "missing" && tonePhoneBandClass("attention"))}>
                  <span className="min-w-0 break-words">{line.itemName} ×{line.boughtQty}</span>
                  <b className="e-tnum shrink-0">{line.cost.state === "missing" ? "No cost entered" : lineCostText(line)}</b>
                </li>
              ))}
              {notBought.length ? (
                <li className={cn("flex justify-between gap-3 px-3 py-1.5", SMALL)}>
                  <span className="min-w-0 break-words">{notBought.map((line) => line.itemName).join(", ")}</span>
                  <span className={MUTED}>Not bought</span>
                </li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
