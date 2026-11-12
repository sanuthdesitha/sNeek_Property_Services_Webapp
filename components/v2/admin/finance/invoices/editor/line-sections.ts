/**
 * How the editor lays its lines out. Grouped view uses the PDF's own grouping
 * (groupInvoiceLines: property sections alphabetically, extras last, order kept
 * within a section), so the screen reads the way the document prints. A drag
 * can only reorder within a section: across sections the PDF decides.
 */
import { groupInvoiceLines, shouldGroupInvoice } from "@/lib/billing/invoice-grouping";
import type { EditorLine } from "@/lib/billing/client-invoice-editor-types";

export type LineSection = {
  key: string;
  /** null for the flat (ungrouped) view: no heading row. */
  title: string | null;
  lines: EditorLine[];
  /** Section subtotal from the PDF's grouping function. */
  subtotal: number;
};

export function lineSections(lines: EditorLine[], grouped: boolean): LineSection[] {
  if (!grouped) return [{ key: "all", title: null, lines, subtotal: 0 }];
  return groupInvoiceLines(lines).map((group) => ({
    key: group.key,
    title: group.title,
    lines: group.lines,
    subtotal: group.subtotal,
  }));
}

/** Whether the PDF prints section headings for these lines. */
export function pdfGroupsLines(lines: EditorLine[]): boolean {
  return shouldGroupInvoice(groupInvoiceLines(lines));
}

/**
 * The full stored order after moving `activeId` onto `overId`, or null when
 * the move is refused (different sections, unknown ids, no change).
 */
export function reorderWithinSection(sections: LineSection[], activeId: string, overId: string): string[] | null {
  if (activeId === overId) return null;
  const from = sections.findIndex((section) => section.lines.some((line) => line.id === activeId));
  const to = sections.findIndex((section) => section.lines.some((line) => line.id === overId));
  if (from < 0 || to < 0 || from !== to) return null;
  const ids = sections[from].lines.map((line) => line.id);
  const fromIndex = ids.indexOf(activeId);
  const toIndex = ids.indexOf(overId);
  ids.splice(toIndex, 0, ids.splice(fromIndex, 1)[0]);
  return sections.flatMap((section, index) => (index === from ? ids : section.lines.map((line) => line.id)));
}
