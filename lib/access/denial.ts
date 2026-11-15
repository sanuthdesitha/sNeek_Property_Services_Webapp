/**
 * Access-denied explanations (board "Access denied", 2026-11). Every portal's
 * denial page answers the same questions in plain words: what you tried, why
 * not, who can change it (or who can help), and a way back.
 *
 * Plain module (no "use client", no server imports): the server loader, the
 * page components and the tests share it. It decides wording only; access is
 * decided by middleware and the live session/role guards, never here.
 *
 * Privacy: the page names the AREA, never a record. The path is shortened by
 * `displayFromPath` and the wording is the same whether or not a record exists.
 */
import { OPS_FEATURES, type OpsFeature } from "@/lib/rbac/ops-catalog";
import { displayFromPath, safeFromPath } from "./return-path";

/** The portals that have their own denial page. */
export const DENIAL_PORTALS = ["admin", "cleaner", "client", "laundry", "qa", "maintenance"] as const;
export type DenialPortal = (typeof DENIAL_PORTALS)[number];

/** Why an office page refused: an area switched off, an administrators-only page, or a page of another portal. */
export type OfficeDenialReason = "feature" | "role" | "portal";

/** A run of text; `strong` parts are names and settings the reader looks for. */
export type DenialTextPart = string | { strong: string } | { link: string; href: string };
export type DenialText = readonly DenialTextPart[];

export type DenialAnswer = { label: string; text: DenialText; path?: string | null; pathIsNew?: boolean };

export type DenialAsk =
  | { kind: "offered"; area: OpsFeature; areaLabel: string; fromLabel: string; administrators: readonly string[]; viewerName: string }
  | { kind: "not_offered"; reason: string };

export type DenialView = {
  state: "denied";
  portal: DenialPortal;
  eyebrow: string;
  title: string;
  intro: string | null;
  answers: readonly DenialAnswer[];
  /** The main way back. For office pages a "Back to where you were" history step comes first. */
  back: { label: string; href: string };
  historyBack: boolean;
  ask: DenialAsk | null;
  /** One closing line under the buttons, or null. */
  footnote: string | null;
  signOut: boolean;
};

/** Not a denial: the permission read failed. Shown with Try again, never as "You can't open…". */
export type DenialUnknownView = { state: "unknown"; portal: DenialPortal; title: string; message: string };

/** An administrator (not testing as anyone) opened the explanation directly: nothing is refused. */
export type DenialNothingView = { state: "nothing"; portal: DenialPortal; title: string; message: string; back: { label: string; href: string } };

export type DenialPageView = DenialView | DenialUnknownView | DenialNothingView;

export const UNKNOWN_TITLE = "Permissions are temporarily unavailable";
export const UNKNOWN_MESSAGE = "Try again in a moment. This is not a refusal: your access could not be read just now.";

export function unknownView(portal: DenialPortal): DenialUnknownView {
  return { state: "unknown", portal, title: UNKNOWN_TITLE, message: UNKNOWN_MESSAGE };
}

/* ── Names of pages and areas ─────────────────────────────────────────── */

/**
 * Office page names, as the admin rail labels them (app/v2/admin/layout.tsx;
 * a test keeps the two in step). Keyed by the first segment after /admin.
 */
export const OFFICE_PAGE_NAMES: Readonly<Record<string, string>> = {
  "": "Command",
  jobs: "Jobs",
  calendar: "Calendar",
  ops: "Live ops",
  approvals: "Approvals",
  messages: "Messages",
  cases: "Cases",
  laundry: "Laundry",
  "lost-found": "Lost and found",
  inventory: "Stock",
  suppliers: "Suppliers",
  properties: "Properties",
  onboarding: "Property onboarding",
  maintenance: "Maintenance",
  accounts: "People",
  hiring: "Hiring",
  quality: "Quality",
  reports: "Insights",
  finance: "Invoices and pay",
  quotes: "Quotes and pricing",
  growth: "Growth",
  forms: "Forms",
  notifications: "Notifications",
  settings: "Settings",
  activity: "Activity log",
  profile: "My profile",
  "delivery-profiles": "Delivery profiles",
  ai: "AI configuration",
  "system/test-as": "Test as",
  diagnostics: "System health",
  // Older pages that are now tabs of a rail page keep their URLs.
  payroll: "Invoices and pay",
  "cleaner-invoices": "Invoices and pay",
  clients: "People",
  cleaners: "People",
  workforce: "People",
  coaching: "Quality",
  pricing: "Quotes and pricing",
  marketing: "Marketing",
  website: "Website",
};

const PORTAL_ROOTS: ReadonlyArray<[DenialPortal, RegExp]> = [
  ["admin", /^\/(?:v2\/)?admin(?:\/|$)/],
  ["cleaner", /^\/(?:v2\/)?cleaner(?:\/|$)/],
  ["client", /^\/(?:v2\/)?client(?:\/|$)/],
  ["laundry", /^\/(?:v2\/)?laundry(?:\/|$)/],
  ["qa", /^\/(?:v2\/)?qa(?:\/|$)/],
  ["maintenance", /^\/(?:v2\/)?maintenance(?:\/|$)/],
];

function pathnameOf(path: string): string {
  return new URL(path, "https://denied.invalid").pathname.replace(/^\/_accounts\/[a-f0-9]{32}(?=\/)/, "");
}

/** Which portal a path belongs to, or null (public pages, unknown paths). */
export function portalOfPath(path: string | null): DenialPortal | null {
  const safe = safeFromPath(path);
  if (!safe) return null;
  const pathname = pathnameOf(safe);
  return PORTAL_ROOTS.find(([, pattern]) => pattern.test(pathname))?.[0] ?? null;
}

/** The office page name for a path ("Invoices and pay"), or null. */
export function officePageName(path: string | null): string | null {
  const safe = safeFromPath(path);
  if (!safe || portalOfPath(safe) !== "admin") return null;
  const rest = pathnameOf(safe).replace(/^\/(?:v2\/)?admin\/?/, "");
  const [first = "", second = ""] = rest.split("/");
  return OFFICE_PAGE_NAMES[`${first}/${second}`] ?? OFFICE_PAGE_NAMES[first] ?? null;
}

/** "Finance & invoicing" reads as "Finance and invoicing". */
export function areaLabel(feature: OpsFeature): string {
  const entry = OPS_FEATURES.find((candidate) => candidate.key === feature);
  return (entry?.label ?? feature).replace(/\s*&\s*/g, " and ");
}

export function isOpsFeature(value: unknown): value is OpsFeature {
  return typeof value === "string" && OPS_FEATURES.some((feature) => feature.key === value);
}

const PORTAL_WORDS: Record<DenialPortal, { app: string; page: string; people: string; role: string }> = {
  admin: { app: "office", page: "An office page", people: "sNeek staff", role: "office staff" },
  cleaner: { app: "cleaner app", page: "A cleaner page", people: "cleaners", role: "cleaner" },
  client: { app: "client portal", page: "A client page", people: "clients", role: "client" },
  laundry: { app: "laundry portal", page: "A laundry page", people: "laundry partners", role: "laundry partner" },
  qa: { app: "QA app", page: "A QA page", people: "QA inspectors", role: "QA inspector" },
  maintenance: { app: "maintenance app", page: "A maintenance page", people: "maintenance workers", role: "maintenance worker" },
};

const PORTAL_PAGES_ARE_FOR: Record<DenialPortal, string> = {
  admin: "Office pages are for sNeek staff.",
  cleaner: "Cleaner pages are for cleaners.",
  client: "Client pages are for clients.",
  laundry: "Laundry pages are for laundry partners.",
  qa: "QA pages are for QA inspectors.",
  maintenance: "Maintenance pages are for maintenance workers.",
};

/** Each portal's own home, the way back from its denial page. */
export const PORTAL_HOME: Record<DenialPortal, { label: string; href: string }> = {
  admin: { label: "Go to Command", href: "/v2/admin" },
  cleaner: { label: "Back to Today", href: "/v2/cleaner" },
  client: { label: "Back to my properties", href: "/v2/client/properties" },
  laundry: { label: "Back to Runs", href: "/v2/laundry/runs" },
  qa: { label: "Back to Today's reviews", href: "/v2/qa" },
  maintenance: { label: "Back to My items", href: "/v2/maintenance" },
};

/** Where a portal person can write to the office, when the portal has such a page. */
const MESSAGE_THE_OFFICE: Partial<Record<DenialPortal, { label: string; href: string }>> = {
  cleaner: { label: "Message the office", href: "/v2/cleaner/hub?tab=chat" },
  client: { label: "send us a message", href: "/v2/client/messages" },
};

/** The denial page of a role's portal (VA works inside the client portal). */
export function denialPortalForRole(role: string | null | undefined): DenialPortal | null {
  switch (role) {
    case "ADMIN":
    case "OPS_MANAGER":
      return "admin";
    case "CLEANER":
      return "cleaner";
    case "CLIENT":
    case "VA":
      return "client";
    case "LAUNDRY":
      return "laundry";
    case "QA_INSPECTOR":
      return "qa";
    case "MAINTENANCE":
      return "maintenance";
    default:
      return null;
  }
}

export function denialPagePath(portal: DenialPortal): string {
  return `/v2/${portal}/access-denied`;
}

/* ── Office (admin) explanations ──────────────────────────────────────── */

export type OfficeViewer = {
  name: string;
  /** True for an administrator acting as themselves. */
  isAdministrator: boolean;
};

/** What the live policy says about the area of the page that refused. */
export type OfficeAreaFacts =
  | { kind: "area"; area: OpsFeature; level: "off" | "read"; presetName: string | null; presetAudience: "manager" | "assistant"; setOnPerson: boolean }
  | { kind: "unmapped" }
  | { kind: "unknown_page" };

export type OfficeDenialInput = {
  reason: OfficeDenialReason;
  from: string | null;
  viewer: OfficeViewer;
  facts: OfficeAreaFacts;
  administrators: readonly string[];
  /** Label of an administrator capability that would open this page ("Test as"), when one exists. */
  grantLabel: string | null;
  /** Testing as this person: the page shows their answer; requests are not sent for them. */
  impersonating: boolean;
};

function joinNames(names: readonly string[]): DenialText {
  const parts: DenialTextPart[] = [];
  names.forEach((name, index) => {
    if (index > 0) parts.push(index === names.length - 1 ? " or " : ", ");
    parts.push({ strong: name });
  });
  return parts;
}

function triedAnswer(from: string | null, fallbackName: string): DenialAnswer {
  const name = officePageName(from);
  const path = displayFromPath(from);
  return { label: "What you tried", text: [{ strong: name ?? fallbackName }], path, pathIsNew: Boolean(path) };
}

function whoCanChange(administrators: readonly string[], where: string): DenialAnswer {
  const names = administrators.length > 0 ? joinNames(administrators) : [];
  return {
    label: "Who can change it",
    text: names.length > 0 ? ["An administrator: ", ...names, `, in ${where}.`] : [`An administrator, in ${where}.`],
  };
}

const ACCESS_SETTINGS = "Settings › Access and permissions";

function featureWhyNot(facts: OfficeAreaFacts): DenialText {
  if (facts.kind === "unmapped") {
    return ["This page has not been given an area in Access and permissions yet, so it stays closed to operations managers."];
  }
  if (facts.kind === "unknown_page") {
    return ["Your access does not include the page you opened."];
  }
  const who = facts.presetAudience === "assistant" ? "an office assistant" : "an operations manager";
  const levelWord = facts.level === "off" ? "Off" : "View";
  const levelTail = facts.level === "read" ? ", which does not open this page." : ".";
  const area = areaLabel(facts.area);
  const lead: DenialText = facts.presetName
    ? [`You are ${who} with the `, { strong: facts.presetName }, " access."]
    : [`You are ${who}.`];
  const setting: DenialText = facts.setOnPerson
    ? [` Your own setting turns "${area}" `, { strong: levelWord }, levelTail]
    : facts.presetName
      ? [` In it, "${area}" is set to `, { strong: levelWord }, levelTail]
      : [` "${area}" is set to `, { strong: levelWord }, levelTail];
  return [...lead, ...setting];
}

export function officeDenialView(input: OfficeDenialInput): DenialView {
  const home = PORTAL_HOME.admin;
  if (input.reason === "portal") {
    const portal = portalOfPath(input.from);
    const words = PORTAL_WORDS[portal && portal !== "admin" ? portal : "cleaner"];
    return {
      state: "denied",
      portal: "admin",
      eyebrow: "Access",
      title: `This page is in the ${words.app}`,
      intro: "Nothing is wrong with the app. Office accounts open the office, not the other portals.",
      answers: [
        { label: "What you tried", text: [{ strong: words.page }], path: displayFromPath(input.from), pathIsNew: Boolean(input.from) },
        { label: "Why not", text: [`The ${words.app} is for ${words.people}. You are signed in as office staff.`] },
        { label: "Who can help", text: ["An administrator can open it as one of them with ", { strong: "Test as" }, ", which shows exactly what that person sees."] },
      ],
      back: home,
      historyBack: true,
      ask: null,
      footnote: null,
      signOut: false,
    };
  }

  if (input.reason === "role") {
    const answers: DenialAnswer[] = [
      triedAnswer(input.from, "An administrators-only page"),
      { label: "Why not", text: ["It is never part of an operations manager's access, whatever the level."] },
      input.grantLabel
        ? { label: "Who can change it", text: ["Only an administrator can give you ", { strong: input.grantLabel }, `, in ${ACCESS_SETTINGS}.`] }
        : { label: "Who can change it", text: ["Only an administrator can make you an administrator."] },
    ];
    return {
      state: "denied",
      portal: "admin",
      eyebrow: "Access",
      title: "This page is for administrators",
      intro: "Nothing is wrong with the app. This page belongs to administrators.",
      answers,
      back: home,
      historyBack: true,
      ask: { kind: "not_offered", reason: input.grantLabel ? "Ask an administrator directly: this needs a grant to you, not an area of your access." : "\"Ask an administrator\" is not offered: the answer can only be a role change." },
      footnote: "Your menu on the left shows only what you can open.",
      signOut: false,
    };
  }

  const pageName = officePageName(input.from);
  const title = pageName ? `You can't open ${pageName} yet` : "You can't open this page yet";
  const ask: DenialAsk | null =
    input.facts.kind !== "area"
      ? { kind: "not_offered", reason: "\"Ask an administrator\" needs the area of the page, which is not known here." }
      : input.impersonating
        ? { kind: "not_offered", reason: "Not while testing as someone: the request would be sent in their name." }
        : { kind: "offered", area: input.facts.area, areaLabel: areaLabel(input.facts.area), fromLabel: pageName ?? areaLabel(input.facts.area), administrators: input.administrators, viewerName: input.viewer.name };
  return {
    state: "denied",
    portal: "admin",
    eyebrow: "Access",
    title,
    intro: "Nothing is wrong with the app. Your access does not include this part of the office.",
    answers: [triedAnswer(input.from, "An office page"), { label: "Why not", text: featureWhyNot(input.facts) }, whoCanChange(input.administrators, ACCESS_SETTINGS)],
    back: home,
    historyBack: true,
    ask,
    footnote: "Your menu on the left shows only what you can open.",
    signOut: false,
  };
}

/** The note under "Ask an administrator…", in the board's words. */
export function askFootnote(ask: Extract<DenialAsk, { kind: "offered" }>): string {
  return `"Ask an administrator" sends an inbox message (not email, not SMS) to the administrators: "${ask.viewerName} asked for ${ask.areaLabel}, from ${ask.fromLabel}." It does not change your access.`;
}

/* ── Portal explanations (cleaner, client, laundry, QA, maintenance) ──── */

export type PortalViewer = {
  name: string;
  /** Client portal: the client account's name ("Northside Lets"). */
  organisation: string | null;
};

export type PortalDenialInput = {
  portal: Exclude<DenialPortal, "admin">;
  from: string | null;
  viewer: PortalViewer;
  /** The office phone number from company details; empty or null when not set. */
  officePhone: string | null;
  impersonating: boolean;
};

function portalTitle(portal: Exclude<DenialPortal, "admin">, tried: DenialPortal | null): string {
  if (portal === "client" && tried === "admin") return "This page is for the sNeek office";
  return `This page isn't in your ${PORTAL_WORDS[portal].app}`;
}

function portalTried(from: string | null, own: DenialPortal): DenialAnswer {
  const tried = portalOfPath(from);
  const path = displayFromPath(from);
  const text: DenialText = tried === "admin"
    ? ["An office page"]
    : tried && tried !== own
      ? [PORTAL_WORDS[tried].page]
      : tried === own
        ? [`A page in your ${PORTAL_WORDS[own].app}`]
        : ["A page your account does not open"];
  return { label: "What you tried", text, path };
}

function portalWhyNot(input: PortalDenialInput): DenialText {
  const tried = portalOfPath(input.from);
  const own = PORTAL_WORDS[input.portal];
  const signedInAs: DenialText = input.portal === "client"
    ? ["You're signed in as ", { strong: input.viewer.organisation ? `${input.viewer.name}, ${input.viewer.organisation}` : input.viewer.name }, "."]
    : ["You're signed in as ", { strong: `${input.viewer.name}, ${own.role}` }, "."];
  if (input.portal === "client") return [...signedInAs, " Your cleans, reports and invoices are in your portal."];
  if (tried === "admin") return [...signedInAs, " Office pages are for sNeek staff."];
  if (tried && tried !== input.portal) return [...signedInAs, ` ${PORTAL_PAGES_ARE_FOR[tried]}`];
  return [...signedInAs, " Your account does not open this page."];
}

/** "The office: call 02 9000 0000." or, with no number set up, says so. */
function portalHelp(input: PortalDenialInput): DenialAnswer {
  const phone = input.officePhone?.trim() || null;
  const message = MESSAGE_THE_OFFICE[input.portal];
  const phonePart: DenialText = phone ? ["call ", { strong: phone }] : [];
  const noPhone = "No office phone number is set in company details yet.";
  if (input.portal === "client") {
    const lead: DenialText = message ? ["sNeek: ", { link: message.label, href: message.href }] : ["sNeek"];
    const tail: DenialText = phone ? [" or ", ...phonePart, ". We reply within business hours."] : [". We reply within business hours. ", noPhone];
    return { label: "Who can help", text: [...lead, ...tail] };
  }
  if (message) {
    const tail: DenialText = phone ? [" or ", ...phonePart, "."] : [". ", noPhone];
    return { label: "Who can help", text: ["The office: ", { link: message.label, href: message.href }, ...tail] };
  }
  return { label: "Who can help", text: phone ? ["The office: ", ...phonePart, "."] : ["The office. ", noPhone] };
}

export function portalDenialView(input: PortalDenialInput): DenialView {
  return {
    state: "denied",
    portal: input.portal,
    eyebrow: "Access",
    title: portalTitle(input.portal, portalOfPath(input.from)),
    intro: null,
    answers: [portalTried(input.from, input.portal), { label: "Why not", text: portalWhyNot(input) }, portalHelp(input)],
    back: PORTAL_HOME[input.portal],
    historyBack: false,
    ask: null,
    footnote: input.impersonating ? "You are testing as this person: this is exactly the answer they would see." : null,
    // Signing out while testing would sign out the administrator, not the person.
    signOut: !input.impersonating,
  };
}

export function nothingDeniedView(): DenialNothingView {
  return {
    state: "nothing",
    portal: "admin",
    title: "Nothing is refused",
    message: "Administrators can open every office page, so there is nothing to explain here.",
    back: PORTAL_HOME.admin,
  };
}

/** Plain text of a run (tests, accessible names). */
export function denialPlainText(text: DenialText): string {
  return text.map((part) => (typeof part === "string" ? part : "strong" in part ? part.strong : part.link)).join("");
}
