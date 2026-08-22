/**
 * WHAT THE PERSON DOING THE WORK NEEDS TO KNOW, AND WHAT THEY GET PAID.
 *
 * Two concerns in one module because both are stamped on an assignment at the
 * same moment and neither makes sense alone: "go here, this is how you get in,
 * and this is what it pays."
 *
 * INSTRUCTIONS ARE A LIST OF TYPED BLOCKS, not a set of columns. The office
 * keeps discovering new things worth saying — a gate code, a photo of which
 * meter, where to collect a key, who to ring — and every one of those as its
 * own column is a migration plus a form field nobody fills in. A list lets an
 * admin add as many as the job needs and no more.
 *
 * The blocks live ON THE ITEM rather than per assignment. A maintenance worker,
 * a cleaner and a QA inspector can all be on the same repair, and copying the
 * access notes three times guarantees two of them go stale.
 *
 * PAY IS FIXED OR HOURLY, because a tap washer is a price and a repaint is a
 * day rate. Anything else — a rate with no hours, a negative fee — resolves to
 * "no pay set" rather than to a number nobody intended, since a wrong figure
 * flows onto somebody's invoice and is found at the worst moment.
 *
 * PURE — no DB, no I/O.
 */

export type InstructionKind = "TEXT" | "PHOTOS" | "PICKUP" | "CONTACT";

export interface InstructionBlock {
  id: string;
  kind: InstructionKind;
  /** Heading the assignee reads first. */
  title: string;
  /** TEXT and PICKUP: the prose. */
  body?: string;
  /** PHOTOS: S3 keys. */
  photoKeys?: string[];
  /** PICKUP: where to go. */
  address?: string;
  /** CONTACT: who to ring when it goes wrong. */
  contactName?: string;
  contactPhone?: string;
}

const KINDS: InstructionKind[] = ["TEXT", "PHOTOS", "PICKUP", "CONTACT"];

export const INSTRUCTION_KIND_LABELS: Record<InstructionKind, string> = {
  TEXT: "Note",
  PHOTOS: "Photos",
  PICKUP: "Pickup location",
  CONTACT: "Who to contact",
};

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Read stored instruction blocks.
 *
 * A block with a title but no content is dropped: an empty card on a phone is
 * worse than nothing, because it reads as information that failed to load
 * rather than information nobody entered.
 */
export function parseInstructions(raw: unknown): InstructionBlock[] {
  if (!Array.isArray(raw)) return [];

  const blocks: InstructionBlock[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as Record<string, unknown>;

    const kind = KINDS.includes(row.kind as InstructionKind)
      ? (row.kind as InstructionKind)
      : "TEXT";

    const photoKeys = Array.isArray(row.photoKeys)
      ? row.photoKeys
          .map((key) => text(key, 512))
          .filter((key): key is string => Boolean(key))
          .slice(0, 20)
      : [];

    const body = text(row.body, 4000);
    const address = text(row.address, 400);
    const contactName = text(row.contactName, 160);
    const contactPhone = text(row.contactPhone, 60);

    const block: InstructionBlock = {
      id: text(row.id, 64) ?? `instruction-${index + 1}`,
      kind,
      title: text(row.title, 160) ?? INSTRUCTION_KIND_LABELS[kind],
      ...(body ? { body } : {}),
      ...(photoKeys.length > 0 ? { photoKeys } : {}),
      ...(address ? { address } : {}),
      ...(contactName ? { contactName } : {}),
      ...(contactPhone ? { contactPhone } : {}),
    };

    const hasContent =
      Boolean(body) ||
      Boolean(address) ||
      Boolean(contactName) ||
      Boolean(contactPhone) ||
      photoKeys.length > 0;

    if (hasContent) blocks.push(block);
  });

  return blocks.slice(0, 30);
}

export type PayType = "FIXED" | "HOURLY";
export type PayPayer = "COMPANY" | "CLIENT";

export interface AssignmentPay {
  type: PayType;
  /** FIXED: the fee. HOURLY: the rate. */
  amount: number;
  hours?: number;
  payer: PayPayer;
  /** What the assignee is actually owed. */
  total: number;
}

/**
 * Resolve what an assignment pays, or null when nothing usable was set.
 *
 * Null rather than zero: "no pay recorded" and "this job pays nothing" are
 * different statements, and only one of them should put a line on an invoice.
 */
export function resolveAssignmentPay(input: {
  payType?: string | null;
  payAmount?: number | null;
  payHours?: number | null;
  payPayer?: string | null;
}): AssignmentPay | null {
  const amount = Number(input.payAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const payer: PayPayer = input.payPayer === "CLIENT" ? "CLIENT" : "COMPANY";

  if (input.payType === "HOURLY") {
    const hours = Number(input.payHours);
    // An hourly rate with no hours cannot produce a total, and defaulting to
    // one hour would invent a figure the office never agreed.
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return {
      type: "HOURLY",
      amount,
      hours,
      payer,
      // Rounded to cents: floating hours times a rate produces long tails that
      // then disagree with the invoice total by a cent.
      total: Math.round(amount * hours * 100) / 100,
    };
  }

  return { type: "FIXED", amount, payer, total: Math.round(amount * 100) / 100 };
}

/** How the pay reads on screen and on an invoice line. */
export function describePay(pay: AssignmentPay): string {
  if (pay.type === "HOURLY") {
    return `${pay.hours} h × $${pay.amount.toFixed(2)} = $${pay.total.toFixed(2)}`;
  }
  return `$${pay.total.toFixed(2)} fixed`;
}

/**
 * May this person be assigned QA on this job?
 *
 * THE FAILSAFE. Someone who cleaned a property must never inspect their own
 * clean — not as a UI convention a direct API call could bypass, but as a rule
 * the assignment path asks before it writes. Self-review is not review: it
 * would quietly corrupt every quality figure downstream, and the corruption
 * would be invisible precisely because the scores would look fine.
 */
export function mayAssignQa(input: {
  candidateUserId: string;
  /** Everyone who worked the clean this QA covers. */
  jobCleanerUserIds: readonly string[];
}): boolean {
  return !input.jobCleanerUserIds.includes(input.candidateUserId);
}
