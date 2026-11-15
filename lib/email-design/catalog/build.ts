/**
 * Builders for email design definitions (version-1 documents written in code).
 * Plain module. Block ids are assigned in order (b1, b2, …) so a definition's
 * ids are stable from one release to the next.
 */
import { inline } from "../inline";
import type {
  CalloutTone,
  DetailsRow,
  EmailBlock,
  EmailBlockType,
  EmailDesignDefinition,
  EmailDocument,
  EmailSampleSet,
  EmailVariable,
  EmailValueFormat,
} from "../types";

type Draft<T> = T extends EmailBlock ? Omit<T, "id"> : never;
export type BlockDraft = Draft<EmailBlock>;

type BlockOptions = { showIf?: string; lock?: "fixed" | "required" };

export const heading = (text: string, options: BlockOptions = {}): BlockDraft => ({ type: "heading", text: inline(text), ...options });
export const paragraph = (text: string, options: BlockOptions = {}): BlockDraft => ({ type: "paragraph", text: inline(text), ...options });
export const note = (text: string, options: BlockOptions = {}): BlockDraft => ({ type: "note", text: inline(text), ...options });
export const callout = (tone: CalloutTone, text: string, options: BlockOptions = {}): BlockDraft => ({ type: "callout", tone, text: inline(text), ...options });
export const button = (label: string, link: string, options: BlockOptions & { labelValue?: string } = {}): BlockDraft => ({ type: "button", label, link, ...options });
export const lineItems = (source: string, options: BlockOptions = {}): BlockDraft => ({ type: "lineItems", source, ...options });
export const photos = (source: string, caption: string, options: BlockOptions = {}): BlockDraft => ({ type: "photos", source, caption: inline(caption), ...options });
export const code = (source: string, options: BlockOptions = {}): BlockDraft => ({ type: "code", source, ...options });
export const divider = (options: BlockOptions = {}): BlockDraft => ({ type: "divider", ...options });
export const details = (rows: ReadonlyArray<readonly [string, string]>, options: BlockOptions = {}): BlockDraft => ({
  type: "details",
  rows: rows.map(([label, value], index): DetailsRow => ({ id: `r${index + 1}`, label, value: inline(value) })),
  ...options,
});

/** The button every shared template carried: the sender's action link and label, or the portal. */
export const actionButton = (label: string): BlockDraft => button(label, "actionUrl", { labelValue: "actionLabel" });

export function doc(subject: string, preheader: string, blocks: readonly BlockDraft[], reference?: string): EmailDocument {
  return {
    subject: inline(subject),
    preheader: inline(preheader),
    ...(reference ? { reference } : {}),
    blocks: blocks.map((block, index) => ({ ...block, id: `b${index + 1}` }) as EmailBlock),
  };
}

type VarOptions = { format?: EmailValueFormat; required?: boolean; keep?: boolean; fallback?: string; textTwin?: string };

export function v(name: string, label: string, sample: string, options: VarOptions = {}): EmailVariable {
  return { name, label, sample, ...options };
}

/** Values every email can use (filled in by the system at send time). */
export const COMMON_VARIABLES: readonly EmailVariable[] = [
  v("companyName", "Company name", "sNeek Property Services"),
  v("appUrl", "App link", "https://app.sneek.example/", { format: "url" }),
  v("loginUrl", "Sign-in link", "https://app.sneek.example/login", { format: "url" }),
  v("supportEmail", "Office email", "office@sneek.example"),
  v("currentDate", "Today's date", "12 November 2026"),
];

/** The action link and label the shared templates inferred (sender's link, else the portal). */
export const ACTION_VARIABLES: readonly EmailVariable[] = [
  v("actionUrl", "Button link", "https://app.sneek.example/v2", { format: "url" }),
  v("actionLabel", "Button label (from the sender)", ""),
];

export const GENERAL_BLOCKS: readonly EmailBlockType[] = ["heading", "paragraph", "details", "callout", "button", "divider", "signature", "note"];

/** A second invented sample set, value by value, for the sample picker. */
const ALTERNATE: Record<string, string> = {
  userName: "Ravi",
  cleanerName: "Ravi Mehta",
  clientName: "Tom",
  recipientName: "Tom",
  propertyName: "Manly Loft",
  propertyAddress: "12 Fairlight St, Manly",
  jobNumber: "J-1061",
  jobType: "Deep clean",
  when: "Fri 13 Nov, 1:00 pm",
  cleanDate: "Fri 13 Nov",
  invoiceNumber: "INV-2318",
  totalAmount: "$1,204.50",
  quoteTotal: "$612.00",
};

export function design(input: Omit<EmailDesignDefinition, "samples" | "allowedBlocks" | "variables"> & {
  variables: readonly EmailVariable[];
  allowedBlocks?: readonly EmailBlockType[];
  samples?: readonly EmailSampleSet[];
  /** Add the action link variables (shared templates). */
  action?: boolean;
}): EmailDesignDefinition {
  const names = new Set(input.variables.map((variable) => variable.name));
  const variables = [
    ...input.variables,
    ...COMMON_VARIABLES.filter((variable) => !names.has(variable.name)),
    ...(input.action ? ACTION_VARIABLES.filter((variable) => !names.has(variable.name)) : []),
  ];
  const typical = Object.fromEntries(variables.map((variable) => [variable.name, variable.sample]));
  const alternate = { ...typical, ...Object.fromEntries(Object.entries(ALTERNATE).filter(([name]) => names.has(name))) };
  const { action: _action, ...rest } = input;
  return {
    ...rest,
    variables,
    allowedBlocks: input.allowedBlocks ?? (input.security ? [] : GENERAL_BLOCKS),
    samples: input.samples ?? [
      { id: "typical", label: "Typical: The Bondi Studio · Jane", values: typical },
      { id: "second", label: "Second: Manly Loft · Ravi", values: alternate },
    ],
  };
}
