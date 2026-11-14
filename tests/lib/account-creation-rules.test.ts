import { describe, expect, it } from "vitest";
import {
  clientLoginRefusal,
  emailFailed,
  emailInUseMessage,
  hireRefusal,
  hiresBecomeLabel,
  inviteRefusal,
  invitationEmailSentence,
  type AccountCreator,
} from "@/lib/accounts/create-account-rules";
import { cardBand, moveRefusal, stageEmailTemplate, testPill, parseInterviewScores, type CardFacts } from "@/lib/hiring/pipeline";
import { duplicateReasons, rankDuplicates } from "@/lib/clients/duplicate-rules";

const admin: AccountCreator = { heldRoles: ["ADMIN"], impersonating: false };
const ops: AccountCreator = { heldRoles: ["OPS_MANAGER"], impersonating: false, hiringLevel: "manage" };

describe("who may create which account (owner defaults 2026-11-16)", () => {
  it("Invite person is administrators only and never while testing as someone", () => {
    expect(inviteRefusal(admin)).toBeNull();
    expect(inviteRefusal(ops)).toMatch(/Only an administrator/);
    expect(inviteRefusal({ ...admin, impersonating: true })).toMatch(/testing as someone/);
  });

  it("operations managers hire only Cleaner and Laundry accounts, with the Hiring pack at Manage", () => {
    expect(hireRefusal(ops, "CLEANER")).toBeNull();
    expect(hireRefusal(ops, "LAUNDRY")).toBeNull();
    for (const kind of ["OPS_MANAGER", "QA_INSPECTOR", "MAINTENANCE"]) expect(hireRefusal(ops, kind)).toMatch(/Only an administrator can hire/);
    expect(hireRefusal({ ...ops, hiringLevel: "read" }, "CLEANER")).toMatch(/managing Hiring/);
    expect(hireRefusal({ heldRoles: ["CLEANER"], impersonating: false }, "CLEANER")).toMatch(/Only an administrator or an operations manager/);
  });

  it("administrators hire into any staff kind but never a client login or an administrator; ADMIN ignores packs", () => {
    for (const kind of ["CLEANER", "LAUNDRY", "QA_INSPECTOR", "MAINTENANCE", "OPS_MANAGER"]) expect(hireRefusal({ ...admin, hiringLevel: "off" }, kind)).toBeNull();
    expect(hireRefusal(admin, "CLIENT")).toMatch(/cannot be created from Hiring/);
    expect(hireRefusal(admin, "ADMIN")).toMatch(/cannot be created from Hiring/);
  });

  it("the account role is never guessed, and testing-as refuses hiring", () => {
    expect(hireRefusal(admin, null)).toMatch(/no longer guesses/);
    expect(hireRefusal({ ...admin, impersonating: true }, "CLEANER")).toMatch(/testing as someone/);
  });

  it("client portal logins from Add client keep the office rule and refuse testing-as", () => {
    expect(clientLoginRefusal(ops)).toBeNull();
    expect(clientLoginRefusal({ ...ops, impersonating: true })).toMatch(/testing as someone/);
    expect(clientLoginRefusal({ heldRoles: ["QA_INSPECTOR"], impersonating: false })).not.toBeNull();
  });

  it("explains a used email in words: client logins cannot become staff, deactivated accounts point to reactivation", () => {
    expect(emailInUseMessage({ id: "1", email: "a@x", role: "CLIENT", isActive: true, clientName: "Harbour View Stays" }, "staff")).toBe("a@x is a client login for Harbour View Stays. A client login cannot become staff; ask for another email.");
    expect(emailInUseMessage({ id: "1", email: "a@x", role: "CLEANER", isActive: false }, "staff")).toMatch(/Cleaner, deactivated\)\. Open that account to reactivate it instead\./);
    expect(emailInUseMessage({ id: "1", email: "a@x", role: "CLEANER", isActive: true }, "staff")).not.toMatch(/reactivate/);
  });

  it("queued is not delivered: accepted reads as queued; a failure is honest", () => {
    const user = { id: "u", name: "R", email: "r@x", role: "CLEANER" };
    expect(invitationEmailSentence({ user, email: { state: "ACCEPTED", error: null } })).toMatch(/queued .*delivery is not confirmed/);
    expect(invitationEmailSentence({ user, email: { state: "NOT_ACCEPTED", error: "mailbox unavailable" } })).toMatch(/could not be emailed: mailbox unavailable/);
    expect(emailFailed({ signIn: "INVITATION", email: { state: "UNKNOWN", error: null } })).toBe(true);
    expect(emailFailed({ signIn: "PASSWORD", email: { state: "NOT_SENT", error: null } })).toBe(false);
    expect(hiresBecomeLabel("CLEANER")).toBe("Cleaner accounts");
    expect(hiresBecomeLabel(null)).toBe("Not chosen");
  });
});

describe("hiring pipeline rules", () => {
  const base: CardFacts = { status: "NEW", createdAt: "2026-11-10T00:00:00Z", testScore: null, testState: "none", passMark: 70, repliesReceived: 0, lastReplyAt: null, lastEmailedAt: null, interviewDate: null, offerSentAt: null, hiredAccount: null };
  const now = new Date("2026-11-14T00:00:00Z");

  it("a stage move opens an email only for Interview, Offer and Declined; Hired is never a plain move", () => {
    expect(stageEmailTemplate("INTERVIEW")).toBe("interview");
    expect(stageEmailTemplate("OFFER")).toBe("offer");
    expect(stageEmailTemplate("REJECTED")).toBe("thank_you");
    expect(stageEmailTemplate("SCREENING")).toBeNull();
    expect(moveRefusal("OFFER", "HIRED")).toMatch(/Mark hired and invite/);
    expect(moveRefusal("HIRED", "SCREENING")).toMatch(/has an account/);
    expect(moveRefusal("NEW", "SCREENING")).toBeNull();
  });

  it("bands say who owes a step, in words", () => {
    expect(cardBand(base, now)).toEqual({ tone: "attention", pill: "First look" });
    expect(cardBand({ ...base, status: "INTERVIEW", interviewDate: "2026-11-19T00:00:00Z" }, now)).toEqual({ tone: "info", pill: "Booked" });
    expect(cardBand({ ...base, status: "INTERVIEW", interviewDate: "2026-11-12T00:00:00Z" }, now)).toEqual({ tone: "attention", pill: "Decide" });
    expect(cardBand({ ...base, status: "OFFER", offerSentAt: "2026-11-11T00:00:00Z" }, now)).toEqual({ tone: "attention", pill: "No reply 3 d" });
    expect(cardBand({ ...base, status: "HIRED", hiredAccount: { signedIn: false, invitationPending: true, invitationExpiresAt: null } }, now).pill).toBe("Invite not opened");
    expect(cardBand({ ...base, status: "HIRED", hiredAccount: { signedIn: true, invitationPending: false, invitationExpiresAt: null } }, now)).toEqual({ tone: "good", pill: "Signed in" });
  });

  it("the test pill always has words", () => {
    expect(testPill({ testScore: 88, testState: "done", passMark: 70 })).toEqual({ text: "Test 88%", tone: "ok" });
    expect(testPill({ testScore: 52, testState: "done", passMark: 70 }).tone).toBe("bad");
    expect(testPill({ testScore: null, testState: "sent", passMark: 70 }).text).toBe("Test sent, not done");
  });

  it("interview scores are 1 to 5 or absent", () => {
    expect(parseInterviewScores({ reliability: 4, detail: 9, communication: "3", extra: 2 })).toEqual({ reliability: 4, communication: 3 });
  });
});

describe("similar client (warn only)", () => {
  const existing = { id: "c", name: "Seaside Stays Pty Ltd", email: "ops@seasidehosting.com.au", phone: "+61412778230", isActive: true, propertyCount: 2 };
  it("matches company domain, phone and name, but not a public mailbox domain", () => {
    expect(duplicateReasons({ name: "Seaside Hosting", email: "priya@seasidehosting.com.au", phone: "0412 778 230" }, existing)).toEqual(["same email domain", "same phone", "similar name"]);
    expect(duplicateReasons({ name: "Other", email: "a@gmail.com" }, { ...existing, email: "b@gmail.com" })).toEqual([]);
    expect(rankDuplicates({ name: "Nothing alike" }, [existing])).toEqual([]);
  });
});
