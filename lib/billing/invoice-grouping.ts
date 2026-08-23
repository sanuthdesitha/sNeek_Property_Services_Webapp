/**
 * HOW AN INVOICE READS.
 *
 * A client with eleven properties was getting one flat list of forty lines in
 * whatever order they happened to be generated. Working out what a single
 * property cost meant reading every row and adding it up by hand, which is the
 * job the invoice was supposed to have already done.
 *
 * `ClientInvoiceLine.propertyId` has existed for a while as the admin's grouping
 * hint, and the PDF never read it — `getClientInvoice` did not even fetch the
 * relation. So the grouping an admin chose was invisible on the one document
 * that mattered. This module is the rule that makes it visible.
 *
 * TWO KINDS OF SECTION, NOT ONE LIST. Cleans belong to a property. Extras —
 * shopping reimbursements, repairs, anything added by hand — are charges the
 * client did not schedule, and burying them inside a property's list of cleans
 * is how somebody discovers a $400 repair by accident three weeks later. They
 * get their own section so they are read rather than found.
 *
 * A LINE'S PROPERTY COMES FROM ITS JOB FIRST. The job is the truthful source: it
 * is where the work actually happened. `line.property` is only the manual hint,
 * used when no job sits behind the line. If neither is present the line still
 * appears, under a plain heading rather than dropped — a charge that vanishes
 * from an invoice is far worse than one filed oddly.
 *
 * PURE — no database, and no formatting of money or dates.
 */

/** Categories that are NOT a scheduled clean at a property. */
const EXTRA_CATEGORIES = new Set(["SHOPPING_REIMBURSEMENT", "MAINTENANCE"]);

const UNASSIGNED_TITLE = "Other charges";
const EXTRAS_TITLE = "Additional charges";

export interface GroupableLine {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  category?: string | null;
  note?: string | null;
  job?: {
    id?: string;
    jobNumber?: string | null;
    scheduledDate?: Date | string | null;
    property?: { name?: string | null; suburb?: string | null } | null;
  } | null;
  property?: { name?: string | null; suburb?: string | null } | null;
}

export interface InvoiceGroup<T extends GroupableLine> {
  /** Stable identity for a React key or a test assertion. */
  key: string;
  /** What the section heading reads. */
  title: string;
  lines: T[];
  subtotal: number;
  /** True for the extras section, which renders differently. */
  isExtras: boolean;
}

/** The heading a property-backed line files under. */
function propertyTitle(line: GroupableLine): string | null {
  const source = line.job?.property ?? line.property ?? null;
  if (!source) return null;
  const name = source.name?.trim();
  if (!name) return null;
  const suburb = source.suburb?.trim();
  return suburb ? `${name} — ${suburb}` : name;
}

function isExtra(line: GroupableLine): boolean {
  return EXTRA_CATEGORIES.has((line.category ?? "").toUpperCase());
}

/**
 * Group an invoice's lines for display.
 *
 * Property sections come first, alphabetically, so the same client's invoices
 * read the same way every month and this month's figure can be compared with
 * last month's without hunting for it. Extras always come last: they are the
 * part a client scans for, and a section that moves around gets missed.
 *
 * ORDER WITHIN A GROUP IS PRESERVED exactly as given. The caller has already
 * sorted by sortOrder, and re-sorting here would silently discard an ordering an
 * admin dragged into place by hand.
 */
export function groupInvoiceLines<T extends GroupableLine>(lines: readonly T[]): InvoiceGroup<T>[] {
  const properties = new Map<string, InvoiceGroup<T>>();
  const extras: T[] = [];
  const unassigned: T[] = [];

  for (const line of lines) {
    if (isExtra(line)) {
      extras.push(line);
      continue;
    }
    const title = propertyTitle(line);
    if (!title) {
      unassigned.push(line);
      continue;
    }
    const existing = properties.get(title);
    if (existing) {
      existing.lines.push(line);
      existing.subtotal += Number(line.lineTotal ?? 0);
    } else {
      properties.set(title, {
        key: `property:${title}`,
        title,
        lines: [line],
        subtotal: Number(line.lineTotal ?? 0),
        isExtras: false,
      });
    }
  }

  const groups = Array.from(properties.values()).sort((a, b) => a.title.localeCompare(b.title));

  // Rounded once, at the end. Accumulating floats across forty lines and then
  // printing each subtotal raw produces sections that visibly fail to add up to
  // the invoice total, which reads as an error in the bill rather than in the
  // arithmetic.
  for (const group of groups) {
    group.subtotal = Number(group.subtotal.toFixed(2));
  }

  if (unassigned.length > 0) {
    groups.push({
      key: "property:unassigned",
      title: UNASSIGNED_TITLE,
      lines: unassigned,
      subtotal: Number(unassigned.reduce((sum, l) => sum + Number(l.lineTotal ?? 0), 0).toFixed(2)),
      isExtras: false,
    });
  }

  if (extras.length > 0) {
    groups.push({
      key: "extras",
      title: EXTRAS_TITLE,
      lines: extras,
      subtotal: Number(extras.reduce((sum, l) => sum + Number(l.lineTotal ?? 0), 0).toFixed(2)),
      isExtras: true,
    });
  }

  return groups;
}

/**
 * Should the document bother with headings at all?
 *
 * One property and no extras is a simple invoice, and wrapping its four lines in
 * a section header named after the only property on it adds a line of chrome and
 * no information.
 */
export function shouldGroupInvoice(groups: readonly InvoiceGroup<GroupableLine>[]): boolean {
  return groups.length > 1;
}
