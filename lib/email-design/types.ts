/**
 * The email design system (approved boards "Email design system", "Email
 * catalogue" and "Email editor", 2026-11). Every email is stored as a list of
 * typed BLOCKS inside one base layout; the HTML, the Outlook table layout and
 * the plain-text part are generated from the blocks plus the theme.
 *
 * Plain module on purpose (no "use client", no server imports): the editor,
 * the API routes, the send path and the tests all read these shapes.
 */

/** One run of inline text. Values are inserted as whole chips, never typed. */
export type InlineSegment =
  | { kind: "text"; text: string; bold?: boolean }
  | { kind: "value"; name: string; bold?: boolean };

export type Inline = InlineSegment[];

export const CALLOUT_TONES = ["note", "action", "problem", "done"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export const CALLOUT_WORD: Record<CalloutTone, string> = {
  note: "Noted",
  action: "Action needed",
  problem: "Problem",
  done: "Done",
};

export type DetailsRow = { id: string; label: string; value: Inline };

type BlockBase = {
  id: string;
  /** Block hidden when this value is empty (e.g. "only when the job has an early check-in"). */
  showIf?: string;
  /**
   * "fixed": security content, cannot be changed, moved or removed.
   * "required": cannot be removed; its words may change but required values stay.
   */
  lock?: "fixed" | "required";
};

export type HeadingBlock = BlockBase & { type: "heading"; text: Inline };
export type ParagraphBlock = BlockBase & { type: "paragraph"; text: Inline };
export type DetailsBlock = BlockBase & { type: "details"; rows: DetailsRow[] };
/** Filled by code from the issued record (a "rows" or "built" value). Only shown or hidden. */
export type LineItemsBlock = BlockBase & { type: "lineItems"; source: string };
/** One per email. The link always comes from the type (a "url" value), never typed. */
export type ButtonBlock = BlockBase & {
  type: "button";
  label: string;
  link: string;
  /** Code-provided label that replaces `label` when the sender gives one (version-1 compatibility). */
  labelValue?: string;
};
export type CalloutBlock = BlockBase & { type: "callout"; tone: CalloutTone; text: Inline };
/** Up to four stamped photos (a "photos" value). Scaled copies; originals stay in the app. */
export type PhotosBlock = BlockBase & { type: "photos"; source: string; caption: Inline };
/** Security emails only: the code, large. */
export type CodeBlock = BlockBase & { type: "code"; source: string };
export type SignatureBlock = BlockBase & { type: "signature"; name: Inline; role: Inline };
export type DividerBlock = BlockBase & { type: "divider" };
/** Small grey text under the main content. */
export type NoteBlock = BlockBase & { type: "note"; text: Inline };

export type EmailBlock =
  | HeadingBlock
  | ParagraphBlock
  | DetailsBlock
  | LineItemsBlock
  | ButtonBlock
  | CalloutBlock
  | PhotosBlock
  | CodeBlock
  | SignatureBlock
  | DividerBlock
  | NoteBlock;

export type EmailBlockType = EmailBlock["type"];

export const EMAIL_BLOCK_TYPES: readonly EmailBlockType[] = [
  "heading",
  "paragraph",
  "details",
  "lineItems",
  "button",
  "callout",
  "photos",
  "code",
  "signature",
  "divider",
  "note",
];

export const BLOCK_LABEL: Record<EmailBlockType, string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  details: "Details",
  lineItems: "Line items",
  button: "Button",
  callout: "Callout",
  photos: "Photo strip",
  code: "Code",
  signature: "Signature",
  divider: "Divider",
  note: "Secondary note",
};

/** The stored email: subject, preheader, an optional reference value for the header and the blocks. */
export type EmailDocument = {
  subject: Inline;
  preheader: Inline;
  /** A value shown at the top right of the header (job, invoice or quote number). */
  reference?: string;
  blocks: EmailBlock[];
};

/**
 * How a value is placed into the email.
 * - text: escaped.
 * - multiline: escaped; line breaks kept.
 * - url: a link this codebase built (http, https, mailto or tel only).
 * - code: a security code (shown large in the code block).
 * - built: a fragment this codebase built and escaped itself (tomorrow's job
 *   list, the stock list). Never free text from a person.
 * - rows: JSON line items `{ head?: [string, string], rows: [{ label, value, kind? }] }`.
 * - photos: JSON `[{ url, caption }]`, at most four are shown.
 */
export type EmailValueFormat = "text" | "multiline" | "url" | "code" | "built" | "rows" | "photos";

export type EmailVariable = {
  name: string;
  label: string;
  /** Invented sample for the preview and the test send. Never personal data. */
  sample: string;
  format?: EmailValueFormat;
  /** A send is blocked when a required value is empty (implies `keep`). */
  required?: boolean;
  /** Locked content: an editor cannot remove this value from the email. */
  keep?: boolean;
  /** Text used when an optional value is empty inside a sentence (default "Not known"). */
  fallback?: string;
  /** For "built" values: the plain-text twin used in the text part. */
  textTwin?: string;
};

export type EmailGroup = "accounts" | "cleaners" | "clients" | "laundry" | "office" | "money" | "marketing";

export const EMAIL_GROUP_LABEL: Record<EmailGroup, string> = {
  accounts: "Accounts",
  cleaners: "Cleaners",
  clients: "Clients",
  laundry: "Laundry",
  office: "Office",
  money: "Money",
  marketing: "Campaigns",
};

/** Where the "Email preferences" link points for the people who receive this email. */
export type PreferencesTarget = "cleaner" | "client" | "laundry" | "staff" | "none";

export type EmailSampleSet = { id: string; label: string; values: Record<string, string> };

export type EmailDesignDefinition = {
  key: string;
  label: string;
  group: EmailGroup;
  /** The notification catalog type this email belongs to (Types and wording). */
  typeKey: string;
  audience: string;
  /** When it is sent, in one sentence. */
  trigger: string;
  /** Security email: the whole body is fixed; only the theme applies; replies are not invited. */
  security: boolean;
  /** Footer line: "You got this because …". */
  whyLine: string;
  preferences: PreferencesTarget;
  variables: readonly EmailVariable[];
  /** Blocks an editor may add to this type. */
  allowedBlocks: readonly EmailBlockType[];
  /** Plain words for "Must stay" (shown in the editor). */
  mustStay: readonly string[];
  /** Where the wording came from (version 1). */
  source: string;
  /** Version 1: the current wording carried over. */
  defaults: EmailDocument;
  /** The shared template this replaces (an admin's raw-HTML edit keeps rendering until a block version is published). */
  templateKey?: string;
  /** Converted from an HTML body that had no heading: the title check is a note, not an error. */
  titleOptional?: boolean;
  /** The wording part this email is (wording-layer emails): its inbox, push and SMS stay in the wording editor. */
  wordingPart?: { typeKey: string; partId: string };
  samples: readonly EmailSampleSet[];
};

/** Business details for the footer (from Company details; never typed in the email). */
export type BusinessDetails = {
  companyName: string;
  abn: string;
  address: string;
  phone: string;
  contactEmail: string;
  logoUrl: string;
  logoDarkUrl: string;
};

export const BUTTON_SHAPES = ["square", "rounded", "pill"] as const;
export type ButtonShape = (typeof BUTTON_SHAPES)[number];

export const HEADING_STYLES = ["serif", "sans"] as const;
export type HeadingStyle = (typeof HEADING_STYLES)[number];

export const COLOUR_PRESET_IDS = ["forest", "harbour", "eucalypt", "ink", "shiraz", "custom"] as const;
export type ColourPresetId = (typeof COLOUR_PRESET_IDS)[number];

/** "Email look": the small set of choices an administrator can change. */
export type EmailTheme = {
  preset: ColourPresetId;
  brandColor: string;
  buttonShape: ButtonShape;
  headingStyle: HeadingStyle;
  /** Empty = the Company & brand logo. */
  logoUrl: string;
  /** Empty = the Company & brand dark-background logo. */
  logoDarkUrl: string;
  /** Empty = the name in EMAIL_FROM (or none). */
  senderName: string;
  /** Empty = the office inbox (Company details accounts email). Security emails never set it. */
  replyTo: string;
  /** One optional extra footer line, at most 140 characters. */
  footerExtra: string;
};
