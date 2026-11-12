"use client";

/**
 * How the office sees an answer in a submission view: a Table answer as a
 * real table (columns in builder order, labelled rows for fixed tables), a
 * Stock count as "item · counted N unit", everything else as the shared
 * formatted value. Shared by the job page's submission review and the Forms
 * page's submission view.
 */
import { formatFieldValue } from "@/lib/forms/field-types";
import { stockCountSummary, tableAnswerGrid } from "@/lib/forms/structured-answers";

export type AnswerField = { id: string; type: string; label?: string; table?: unknown; unit?: unknown; stockItemName?: unknown };

export function isBlockAnswer(field: AnswerField): boolean {
  return field.type === "table";
}

export function TableAnswer({ field, value }: { field: AnswerField; value: unknown }) {
  const grid = tableAnswerGrid(field, value);
  if (!grid) return <p className="text-[0.8125rem] font-[550]">-</p>;
  return (
    <div className="max-w-full overflow-x-auto rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))]">
      <table className="w-full min-w-max border-collapse text-[0.8125rem]">
        <caption className="sr-only">{field.label ?? field.id}</caption>
        <thead className="bg-[hsl(var(--e-surface-raised))]">
          <tr>
            {grid.columns.map((column, index) => (
              <th key={`${column}-${index}`} scope="col" className="border-b border-[hsl(var(--e-border))] px-2.5 py-1.5 text-left font-[600] text-[hsl(var(--e-text-secondary))]">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[hsl(var(--e-border))] last:border-b-0">
              {row.map((cell, cellIndex) => (
                cellIndex === 0 && grid.columns[0] === "Row"
                  ? <th key={cellIndex} scope="row" className="px-2.5 py-1.5 text-left font-[550]">{cell}</th>
                  : <td key={cellIndex} className="px-2.5 py-1.5 e-tnum">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The answer text for inline types (stock count gets its office wording). */
export function inlineAnswerText(field: AnswerField, value: unknown): string {
  if (field.type === "stock_count") return stockCountSummary(field, value);
  return formatFieldValue(field as Parameters<typeof formatFieldValue>[0], value);
}
