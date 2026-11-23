/**
 * The lines a client invoice or credit note sends to Xero, in the order the
 * PDF prints them. Pure: no database, no Xero.
 *
 * WHY THIS EXISTS. The PDF groups lines by property whenever an invoice spans
 * more than one property (`groupInvoiceLines` / `shouldGroupInvoice`), but the
 * Xero push sent lines in their STORED order, which is only grouped when an
 * administrator turned on "Group by property" in the editor. Pushing from the
 * list, bulk, the send flow or the old screen therefore sent whatever order the
 * lines were generated in. Every push and "Update in Xero" now orders lines
 * here, with the PDF's own rule, so Xero reads like the PDF wherever the push
 * started. The stored sortOrder is never changed by this.
 *
 * Xero line items are a flat list with no headings. In a grouped invoice the
 * PDF names the property in the section heading only, so a property line
 * whose description does not already name its property (a hand-added charge
 * grouped under a property, or a custom rate description) is prefixed with the
 * property name, so the grouping is visible in Xero. Quantities, unit amounts,
 * tax, account and item codes are exactly what the push always sent.
 */
import { isShoppingDisbursement, shoppingXeroMapping, type ShoppingXeroMappingSettings } from "@/lib/finance/shopping-accounting";
import { groupInvoiceLines, shouldGroupInvoice, type GroupableLine } from "./invoice-grouping";

type PropertyRef = { name?: string | null; suburb?: string | null } | null | undefined;

/** One stored invoice line as the push reads it. */
export type XeroSourceLine = GroupableLine & {
  category: string;
  note?: string | null;
  job?: {
    jobType?: string | null;
    jobNumber?: string | null;
    property?: PropertyRef;
  } | null;
  property?: PropertyRef;
};

/** One line in the order Xero receives it, with the property it is grouped under (null when none). */
export type OrderedXeroLine<T extends XeroSourceLine> = {
  line: T;
  /** The property name a property section names, or null (ungrouped, extras, other charges). */
  sectionProperty: string | null;
};

export type XeroLineOrder<T extends XeroSourceLine> = {
  /** True when the PDF prints property sections for these lines. */
  grouped: boolean;
  lines: OrderedXeroLine<T>[];
};

/** The Xero integration settings the line mapping reads (accounts: lib/xero/client-invoice-accounts.ts). */
export type XeroLineSettings = ShoppingXeroMappingSettings & {
  defaultItemCode?: string;
  itemCodeByService?: Record<string, string>;
};

/** A line item as `pushClientInvoiceToXero` and the update take it. */
export type XeroLineItem = {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode?: string;
  taxType?: string;
  itemCode?: string;
};

function propertyNameOf(line: XeroSourceLine): string | null {
  const source = line.job?.property ?? line.property ?? null;
  const name = source?.name?.trim();
  return name ? name : null;
}

/**
 * The PDF's order. Ungrouped (one property, no extras) keeps the stored order
 * exactly; grouped is property sections alphabetically, then other charges,
 * then extras, with the stored order kept inside each section.
 */
export function xeroLineOrder<T extends XeroSourceLine>(lines: readonly T[]): XeroLineOrder<T> {
  const groups = groupInvoiceLines(lines);
  if (!shouldGroupInvoice(groups)) {
    return { grouped: false, lines: lines.map((line) => ({ line, sectionProperty: null })) };
  }
  const ordered: OrderedXeroLine<T>[] = [];
  for (const group of groups) {
    const propertySection = !group.isExtras && group.key !== "property:unassigned";
    for (const line of group.lines) {
      ordered.push({ line, sectionProperty: propertySection ? propertyNameOf(line) : null });
    }
  }
  return { grouped: true, lines: ordered };
}

/**
 * The description with the property name in front when the line sits in a
 * property section and does not already name it. Unchanged otherwise.
 */
export function withSectionProperty(description: string, sectionProperty: string | null): string {
  if (!sectionProperty) return description;
  if (description.toLowerCase().includes(sectionProperty.toLowerCase())) return description;
  return `${sectionProperty} - ${description}`;
}

/** The push's description: the stored text, the job number and any per-job note (unchanged rule). */
function pushDescription(line: XeroSourceLine, sectionProperty: string | null): string {
  let description = withSectionProperty(line.description, sectionProperty);
  if (line.job?.jobNumber) description += ` · Job ${line.job.jobNumber}`;
  if (line.note) description += ` — ${line.note}`;
  return description;
}

/**
 * Xero line items for an invoice, in the PDF's order. The amount, tax and
 * item code of each line are mapped exactly as the push always mapped them.
 * Each line's account comes from Settings › Money › Xero › Client invoices
 * (its kind's account, else the sales account; a credit note's own account
 * when chosen). With no sales account, or a disbursement without its own
 * account, this throws before any request (never "200").
 */
export function buildXeroLineItems(
  lines: readonly XeroSourceLine[],
  settings: XeroLineSettings,
  taxType: string | undefined,
  options: { creditNote?: boolean } = {},
): XeroLineItem[] {
  const defaultItemCode = settings.defaultItemCode?.trim() || "";
  const itemCodeByService = settings.itemCodeByService ?? {};
  // Per line: the item code mapped to that job's service type, else the
  // default item code, else none.
  const itemCodeFor = (line: XeroSourceLine) => {
    const service = line.job?.jobType ? itemCodeByService[line.job.jobType]?.trim() : "";
    return service || defaultItemCode || undefined;
  };
  return xeroLineOrder(lines).lines.map(({ line, sectionProperty }) => ({
    description: pushDescription(line, sectionProperty),
    quantity: line.quantity,
    unitAmount: line.unitPrice,
    ...shoppingXeroMapping(line.category, settings, taxType, { creditNote: options.creditNote }),
    itemCode: isShoppingDisbursement(line.category) ? undefined : itemCodeFor(line),
  }));
}
