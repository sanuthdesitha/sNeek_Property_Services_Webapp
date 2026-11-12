/**
 * People directory tabs (the Accounts route, /v2/admin/accounts). PLAIN module:
 * shared by the server page, the legacy redirects and the screen.
 *
 * Drawn tabs: Clients, Cleaners, Office and other staff, Laundry partners and
 * suppliers, Assistants (client assistants, owner decision 2026-11-12) and
 * Invitations; "Everyone" and "Needs attention" are chips that open the
 * all-logins views; "Client logins" stays reachable (Everyone › Client logins
 * and old links).
 *
 * Old links keep their meaning: `?tab=team|staff` → Office, `?tab=vas` →
 * Assistants, `?tab=emails` → Invitations. `?tab=clients` used to be client
 * LOGINS on Accounts; it now opens the Clients tab, which lists each client's
 * logins in its panel (People board: "/accounts?tab= redirect to the
 * matching tab").
 */
import type { AccountTab } from "@/lib/accounts/list/tabs";

export const PEOPLE_TABS = ["clients", "cleaners", "office", "partners", "assistants", "invitations"] as const;
export type PeopleMainTab = (typeof PEOPLE_TABS)[number];

/** Views reached from chips, not drawn as tabs. */
export const PEOPLE_CHIP_VIEWS = ["everyone", "attention", "logins"] as const;
export type PeopleChipView = (typeof PEOPLE_CHIP_VIEWS)[number];

export type PeopleTab = PeopleMainTab | PeopleChipView;

export const PEOPLE_TAB_LABEL: Record<PeopleTab, string> = {
  clients: "Clients",
  cleaners: "Cleaners",
  office: "Office and other staff",
  partners: "Laundry partners and suppliers",
  assistants: "Assistants",
  invitations: "Invitations",
  everyone: "Everyone",
  attention: "Needs attention",
  logins: "Client logins",
};

const LEGACY: Readonly<Record<string, PeopleTab>> = {
  team: "office",
  staff: "office",
  vas: "assistants",
  emails: "invitations",
  "account-emails": "invitations",
};

/** The tab a URL value opens. `fallback` is used for a missing or unknown value. */
export function normalizePeopleTab(value: string | null | undefined, fallback: PeopleTab): PeopleTab {
  const raw = (value ?? "").trim();
  if ((PEOPLE_TABS as readonly string[]).includes(raw) || (PEOPLE_CHIP_VIEWS as readonly string[]).includes(raw)) return raw as PeopleTab;
  return LEGACY[raw] ?? fallback;
}

/** The Accounts list API tab behind a People view that lists logins, else null. */
export const ACCOUNT_LIST_TAB: Partial<Record<PeopleTab, AccountTab>> = {
  cleaners: "cleaners",
  office: "office",
  partners: "partners",
  everyone: "everyone",
  attention: "attention",
  logins: "clients",
};

export function accountListTabFor(tab: PeopleTab): AccountTab | null {
  return ACCOUNT_LIST_TAB[tab] ?? null;
}

/** What a viewer may open on People (server-resolved). */
export type PeopleAccess = {
  /** ADMIN, or OPS_MANAGER with the clients pack (the Clients list, panel and client page). */
  clients: boolean;
};

export function allowedPeopleTabs(access: PeopleAccess): PeopleTab[] {
  return [...PEOPLE_TABS, ...PEOPLE_CHIP_VIEWS].filter((tab) => (tab === "clients" ? access.clients : true));
}

/** Where an old list URL lands: the People route with its tab, keeping every other query value. */
export function peopleRedirectTarget(tab: PeopleTab, searchParams: Record<string, string | string[] | undefined> | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (key === "tab") continue;
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  const rest = params.toString();
  return `/v2/admin/accounts?tab=${tab}${rest ? `&${rest}` : ""}`;
}
