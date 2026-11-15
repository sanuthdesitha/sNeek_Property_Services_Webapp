/**
 * Creating accounts: who may create which kind, and the words the screens use.
 * PLAIN module (no server imports): shared by the routes, the services, the
 * Invite person page, Hiring and Add client, and safe to import from server
 * pages.
 *
 * Owner defaults (2026-11-16, pending owner confirmation):
 *  - Invite person (any staff kind, client logins): administrators only, as
 *    the old dialog was. Operations managers create accounts only through
 *    Hiring, and only Cleaner and Laundry accounts; office roles need an
 *    administrator. Add client keeps its existing rule (administrators and
 *    operations managers with the Clients pack) for the client portal login.
 *  - Nobody creates an account while testing as someone else.
 *  - Every new account gets the single-use, expiring, revocable invitation
 *    link (lib/auth/invitations.ts) instead of an emailed temporary password.
 *    "Set a password now" stays on Invite person for administrators.
 *  - SMS with the invitation link only when ticked; the email is always sent.
 */

export const ACCOUNT_KINDS = ["CLEANER", "LAUNDRY", "QA_INSPECTOR", "MAINTENANCE", "OPS_MANAGER", "ADMIN", "CLIENT"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === "string" && (ACCOUNT_KINDS as readonly string[]).includes(value);
}

/** The role cards on Invite person, in the board's order. Assistant (VA) is shown but made elsewhere. */
export type AccountKindCard = { kind: AccountKind | "VA"; title: string; description: string; disabledReason?: string };

export const ACCOUNT_KIND_CARDS: readonly AccountKindCard[] = [
  { kind: "CLEANER", title: "Cleaner", description: "Jobs, forms and photos on their phone; paid per job" },
  { kind: "LAUNDRY", title: "Laundry partner", description: "Pickups and drop-offs; ABN and bank for invoices" },
  { kind: "QA_INSPECTOR", title: "QA inspector", description: "Inspections and reviews of finished cleans" },
  { kind: "MAINTENANCE", title: "Maintenance worker", description: "Assigned repairs, visits and price requests" },
  { kind: "OPS_MANAGER", title: "Office (ops manager)", description: "The admin screens their permission packs allow" },
  { kind: "ADMIN", title: "Administrator", description: "Everything, including settings and money" },
  { kind: "CLIENT", title: "Client login", description: "A login for an existing client's portal" },
  { kind: "VA", title: "Assistant (VA)", description: "Created from the Assistants tab with its team", disabledReason: "Assistants are created from People › Assistants with their team." },
];

const KIND_LABEL: Record<AccountKind, string> = {
  CLEANER: "Cleaner",
  LAUNDRY: "Laundry partner",
  QA_INSPECTOR: "QA inspector",
  MAINTENANCE: "Maintenance worker",
  OPS_MANAGER: "Ops manager",
  ADMIN: "Administrator",
  CLIENT: "Client login",
};

export function accountKindLabel(kind: string): string {
  return isAccountKind(kind) ? KIND_LABEL[kind] : kind.replace(/_/g, " ").toLowerCase();
}

/** "Hires become": the account kinds a hire can create. Never a client login or an administrator. */
export const HIRE_ACCOUNT_KINDS = ["CLEANER", "LAUNDRY", "QA_INSPECTOR", "MAINTENANCE", "OPS_MANAGER"] as const;
export type HireAccountKind = (typeof HIRE_ACCOUNT_KINDS)[number];

export function isHireAccountKind(value: unknown): value is HireAccountKind {
  return typeof value === "string" && (HIRE_ACCOUNT_KINDS as readonly string[]).includes(value);
}

/** The kinds an operations manager may hire into (owner default 2026-11-16). */
export const OPS_MANAGER_HIRE_KINDS: readonly HireAccountKind[] = ["CLEANER", "LAUNDRY"];

/** The words for a "Hires become" choice, e.g. "Cleaner accounts". */
export function hiresBecomeLabel(kind: string | null | undefined): string {
  if (!kind) return "Not chosen";
  return `${accountKindLabel(kind).replace(/ login$/, "")} accounts`;
}

/** Who is asking, as the server resolved it (actual actor; never an impersonated identity). */
export type AccountCreator = {
  /** Every role the signed-in person holds. */
  heldRoles: readonly string[];
  /** True while an administrator is testing as someone else. */
  impersonating: boolean;
  /** The operations manager's Hiring pack level (ignored for administrators). */
  hiringLevel?: "off" | "read" | "manage" | null;
};

export const IMPERSONATING_REFUSAL = "Accounts cannot be created while you are testing as someone else. Stop testing first.";

function isAdmin(actor: AccountCreator): boolean {
  return actor.heldRoles.includes("ADMIN");
}

/** Null when this person may use Invite person, else why not. */
export function inviteRefusal(actor: AccountCreator): string | null {
  if (actor.impersonating) return IMPERSONATING_REFUSAL;
  if (!isAdmin(actor)) return "Only an administrator can invite people. Operations managers add staff through Hiring.";
  return null;
}

/** Null when this person may mark someone hired into this account kind, else why not. */
export function hireRefusal(actor: AccountCreator, kind: string | null | undefined): string | null {
  if (actor.impersonating) return IMPERSONATING_REFUSAL;
  if (!kind) return "Choose the account role first. Hiring no longer guesses it from the offer title.";
  if (!isHireAccountKind(kind)) return `${accountKindLabel(kind)} accounts cannot be created from Hiring.`;
  if (isAdmin(actor)) return null;
  if (!actor.heldRoles.includes("OPS_MANAGER")) return "Only an administrator or an operations manager can hire.";
  if (actor.hiringLevel !== "manage") return "Your access does not include managing Hiring.";
  if (!OPS_MANAGER_HIRE_KINDS.includes(kind)) return `Only an administrator can hire into ${hiresBecomeLabel(kind)}. Operations managers hire Cleaner and Laundry accounts.`;
  return null;
}

/** Null when this person may give a new client a portal login from Add client, else why not. */
export function clientLoginRefusal(actor: AccountCreator): string | null {
  if (actor.impersonating) return IMPERSONATING_REFUSAL;
  if (isAdmin(actor) || actor.heldRoles.includes("OPS_MANAGER")) return null;
  return "Only the office can give a client a portal login.";
}

/** What already uses an email address, as the screens explain it. */
export type ExistingAccountFacts = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  clientName?: string | null;
};

/** The sentence for an email that is already used. Nothing is created in either case. */
export function emailInUseMessage(existing: ExistingAccountFacts, purpose: "staff" | "client-login"): string {
  if (existing.role === "CLIENT" && purpose === "staff") {
    const owner = existing.clientName ? ` for ${existing.clientName}` : "";
    return `${existing.email} is a client login${owner}. A client login cannot become staff; ask for another email.`;
  }
  const state = existing.isActive ? "active" : "deactivated";
  return `${existing.email} already has an account (${accountKindLabel(existing.role)}, ${state}).${existing.isActive ? "" : " Open that account to reactivate it instead."}`;
}

/** SMS with the invitation link: how the ticked choice turned out. */
export type InvitationSmsState = "NOT_REQUESTED" | "ACCEPTED" | "NOT_SENT" | "NO_PHONE";

/** The provider's answer for the invitation email. Accepted is not delivered. */
export type InvitationEmailState = "ACCEPTED" | "NOT_ACCEPTED" | "UNKNOWN" | "SKIPPED" | "NOT_SENT";

/** The answer every create route returns (no token, no password). */
export type AccountCreateOutcome = {
  user: { id: string; name: string | null; email: string; role: string };
  replayed: boolean;
  signIn: "INVITATION" | "PASSWORD";
  invitation: { expiresAt: string } | null;
  email: { state: InvitationEmailState; error: string | null };
  sms: { state: InvitationSmsState; error: string | null };
};

/** The one-line result the screens show; never claims delivery. */
export function invitationEmailSentence(outcome: Pick<AccountCreateOutcome, "email" | "user">): string {
  switch (outcome.email.state) {
    case "ACCEPTED":
      return `Invitation for ${outcome.user.email} queued with the email provider (delivery is not confirmed).`;
    case "SKIPPED":
      return "The invitation could not be emailed: email is not configured or is switched off. Share the link yourself.";
    case "UNKNOWN":
      return "The email provider's answer was not confirmed. Check the account's emails, or share the link yourself.";
    case "NOT_SENT":
      return "No invitation email was sent.";
    default:
      return `The invitation could not be emailed${outcome.email.error ? `: ${outcome.email.error}` : ""}. Share the link yourself.`;
  }
}

export function emailFailed(outcome: Pick<AccountCreateOutcome, "email" | "signIn">): boolean {
  return outcome.signIn === "INVITATION" && outcome.email.state !== "ACCEPTED";
}
