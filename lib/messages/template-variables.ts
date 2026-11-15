/**
 * Message template variables: one set of names everywhere (owner default
 * 2026-11-17, board "Message templates").
 *
 * Two syntaxes existed. The template editor offered snake_case names
 * ({{client_name}}) that only client automations filled; the inbox "Insert
 * template", Messages › Compose and campaigns fill dotted names
 * ({{client.firstName}}, with filters such as {{job.scheduledFor | date short}}).
 * Client automations now fill the dotted names too and keep the old names as
 * aliases, so templates already written keep working. The editor warns when a
 * template uses a name a place it is used in cannot fill, and offers to
 * replace the old names.
 *
 * What each place fills:
 *  - inbox:      the thread's client only (client.*)
 *  - composer:   the client, cleaner, job, property and quote the office picks
 *  - campaign:   the recipient client only (client.*); any other name stops
 *                the campaign (strict variables)
 *  - automation: AUTOMATION_PATHS below, plus the old snake_case names
 *
 * PURE (plain module, safe in client components and server pages).
 */
import { format } from "date-fns";

export type TemplateDestination = "inbox" | "composer" | "campaign" | "automation";

export const DESTINATION_LABEL: Record<TemplateDestination, string> = {
  inbox: "the inbox Insert template",
  composer: "Messages › Compose",
  campaign: "campaigns",
  automation: "client automations",
};

/** Old automation names → the dotted name that fills the same way (null: no equivalent outside automations). */
export const LEGACY_REPLACEMENTS: Readonly<Record<string, string | null>> = {
  client_name: "client.name",
  property_name: "property.name",
  property_address: "property.address",
  cleaner_name: "cleaner.name",
  next_clean_date: "job.scheduledFor | date day",
  job_type: "job.jobType",
  job_number: "job.jobNumber",
  feedback_url: null,
};

export const LEGACY_NAMES: readonly string[] = Object.keys(LEGACY_REPLACEMENTS);

/** Dotted names client automations fill (besides the old names). */
export const AUTOMATION_PATHS: readonly string[] = [
  "client.name",
  "client.firstName",
  "client.lastName",
  "client.email",
  "client.phone",
  "property.name",
  "property.address",
  "property.suburb",
  "cleaner.name",
  "cleaner.firstName",
  "job.jobNumber",
  "job.jobType",
  "job.scheduledFor",
  "job.scheduledDate",
  "feedback.url",
];

/** Chips in the editor: dotted names, written as they are inserted. */
export const VARIABLE_CHIPS: readonly string[] = [
  "client.firstName",
  "client.name",
  "property.name",
  "property.suburb",
  "job.scheduledFor | date short",
  "job.scheduledFor | time",
  "cleaner.firstName",
  "quote.totalAmount | currency",
];

const COMPOSER_ROOTS = new Set(["client", "cleaner", "job", "property", "quote", "user"]);
export const TEMPLATE_FILTERS = ["date", "time", "currency", "upper", "lower"] as const;

export type TemplateToken = { raw: string; path: string; filter: string };

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

export function templateTokens(text: string | null | undefined): TemplateToken[] {
  if (!text) return [];
  return Array.from(text.matchAll(TOKEN)).map((match) => {
    const [path, ...filterParts] = match[1].split("|").map((part) => part.trim());
    return { raw: match[0], path, filter: filterParts.join("|") };
  });
}

export function isLegacyName(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_REPLACEMENTS, path);
}

/** Whether a place fills this name (path without its filter). */
export function canFill(destination: TemplateDestination, path: string): boolean {
  const root = path.split(".")[0];
  if (destination === "automation") return isLegacyName(path) || AUTOMATION_PATHS.includes(path);
  if (!path.includes(".")) return false;
  if (destination === "composer") return COMPOSER_ROOTS.has(root);
  return root === "client";
}

export type UnfilledReport = { destination: TemplateDestination; names: string[] };

/** Names each place cannot fill, for the places the template is used in. */
export function unfilledNames(texts: ReadonlyArray<string | null | undefined>, destinations: readonly TemplateDestination[]): UnfilledReport[] {
  const paths = Array.from(new Set(texts.flatMap((text) => templateTokens(text).map((token) => token.path))));
  return destinations
    .map((destination) => ({ destination, names: paths.filter((path) => !canFill(destination, path)) }))
    .filter((report) => report.names.length > 0);
}

/** Old names in the text that have a dotted replacement. */
export function replaceableLegacyNames(text: string | null | undefined): string[] {
  return Array.from(new Set(templateTokens(text).map((token) => token.path).filter((path) => isLegacyName(path) && LEGACY_REPLACEMENTS[path] !== null)));
}

/** Replaces old names with their dotted equivalents; names without one stay. */
export function replaceLegacyNames(text: string): string {
  return text.replace(TOKEN, (raw, expression: string) => {
    const [path] = expression.split("|").map((part) => part.trim());
    const replacement = isLegacyName(path) ? LEGACY_REPLACEMENTS[path] : null;
    return replacement ? `{{${replacement}}}` : raw;
  });
}

/** One filter, exactly as the inbox resolver applies it. Unknown filters print the value. */
export function applyTemplateFilter(value: unknown, filter: string): string {
  const [name, ...args] = filter.split(/\s+/);
  if (value === null || value === undefined) return "";
  switch (name) {
    case "date": {
      const date = value instanceof Date ? value : new Date(String(value));
      if (isNaN(date.getTime())) return "";
      return format(date, args[0] === "short" ? "EEE d MMM" : args[0] === "day" ? "dd MMM yyyy" : "PPpp");
    }
    case "time": {
      const date = value instanceof Date ? value : new Date(String(value));
      if (isNaN(date.getTime())) return "";
      return format(date, "h:mm a");
    }
    case "currency":
      return `$${Number(value).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "upper":
      return String(value).toUpperCase();
    case "lower":
      return String(value).toLowerCase();
    default:
      return String(value);
  }
}

export type AutomationValue = string | number | Date | null | undefined;

/**
 * Fills a client automation template: dotted names (with filters) from
 * `values`, and the old snake_case names from `legacy`. A name it does not
 * know becomes empty, as before.
 */
export function renderAutomationTemplate(template: string, values: Readonly<Record<string, AutomationValue>>, legacy: Readonly<Record<string, string>>): string {
  return template.replace(TOKEN, (_raw, expression: string) => {
    const [path, ...filterParts] = expression.split("|").map((part) => part.trim());
    const filter = filterParts.join("|");
    if (!path.includes(".") && Object.prototype.hasOwnProperty.call(legacy, path)) return legacy[path] ?? "";
    const value = Object.prototype.hasOwnProperty.call(values, path) ? values[path] : undefined;
    if (filter) return applyTemplateFilter(value, filter);
    if (value === null || value === undefined) return "";
    // Same as the inbox resolver: no filter prints the value as it is.
    return String(value);
  });
}

/** SMS length: characters and how many texts (160 per text, 153 per part when split). */
export function smsLength(body: string): { characters: number; texts: number } {
  const characters = body.length;
  const texts = characters <= 160 ? 1 : Math.ceil(characters / 153);
  return { characters, texts };
}
