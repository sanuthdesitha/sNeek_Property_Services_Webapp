import { describe, expect, it } from "vitest";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/catalog";
import { decidePersonal, personalSkipText, type ClientSubjectState, type UserSubjectState } from "@/lib/notifications/personal/decide";
import {
  ALWAYS_SENT_TYPES,
  fixedReasonFor,
  parseSwitchId,
  personalTransportsOfType,
  personalTypesFor,
  sanitizeSwitchValues,
  typeSwitchId,
} from "@/lib/notifications/personal/model";
import { legacyClientChanges } from "@/lib/notifications/personal/legacy-client";

/**
 * The personal-switch rule (lib/notifications/personal/decide.ts): only an
 * explicit false blocks, any subject's opt-out stops the message, and the
 * client account's long-standing choices keep their meaning.
 */
function client(overrides: Partial<ClientSubjectState> = {}): ClientSubjectState {
  return {
    kind: "CLIENT", id: "c1", name: "Client One", notificationsEnabled: true,
    events: { enRoute: true, started: true, finished: true }, preferredChannel: "EMAIL", switches: {},
    ...overrides,
  };
}

function user(overrides: Partial<UserSubjectState> = {}): UserSubjectState {
  return { kind: "USER", id: "u1", name: "Login One", role: "CLIENT", switches: {}, allEmailOff: false, disabledEmailKinds: new Set(), ...overrides };
}

describe("client account master switch (the reported bug)", () => {
  const clientTypes = personalTypesFor("CLIENT").filter((entry) => fixedReasonFor(entry, false) === null);

  it("lists every switchable client type from the catalog", () => {
    expect(clientTypes.map((entry) => entry.key)).toEqual(expect.arrayContaining([
      "client.job_updates", "client.lifecycle_email", "client.post_job", "client.documents", "office.cases", "job.reminder.scheduled", "client.approvals", "client.office_messages",
    ]));
  });

  it("blocks every switchable client type on every transport it uses when notifications are off", () => {
    for (const entry of clientTypes) {
      for (const transport of personalTransportsOfType(entry)) {
        const decision = decidePersonal([client({ notificationsEnabled: false })], { typeKey: entry.key, transport });
        expect(decision.allowed, `${entry.key} ${transport}`).toBe(false);
        expect(decision.blocks[0]).toMatchObject({ subjectKind: "CLIENT", switchId: "all" });
      }
    }
  });

  it("blocks a message whose type cannot be told apart (unclassified) as well", () => {
    for (const transport of ["APP", "EMAIL", "SMS"] as const) {
      expect(decidePersonal([client({ notificationsEnabled: false })], { typeKey: `unclassified:${transport.toLowerCase()}`, transport }).allowed).toBe(false);
      expect(decidePersonal([client({ notificationsEnabled: false })], { typeKey: null, transport }).allowed).toBe(false);
    }
  });

  it("records the skip as not sent, naming the client", () => {
    const decision = decidePersonal([user(), client({ notificationsEnabled: false })], { typeKey: "office.cases", transport: "EMAIL" });
    expect(personalSkipText(decision.blocks)).toBe("Not sent: this client has switched these notifications off.");
  });

  it("allows everything when nothing is switched off (nobody silently stops receiving)", () => {
    for (const entry of NOTIFICATION_CATALOG) {
      for (const transport of personalTransportsOfType(entry)) {
        expect(decidePersonal([user(), client()], { typeKey: entry.key, transport }).allowed, `${entry.key} ${transport}`).toBe(entry.key === "client.job_updates" && transport === "SMS" ? false : true);
      }
    }
  });
});

describe("per type and per transport", () => {
  it("a type switched off on email blocks only that type on email", () => {
    const state = client({ switches: { [typeSwitchId("office.cases", "EMAIL")]: false } });
    expect(decidePersonal([state], { typeKey: "office.cases", transport: "EMAIL" }).allowed).toBe(false);
    expect(decidePersonal([state], { typeKey: "office.cases", transport: "APP" }).allowed).toBe(true);
    expect(decidePersonal([state], { typeKey: "client.post_job", transport: "EMAIL" }).allowed).toBe(true);
  });

  it("a whole transport switched off blocks every type on it", () => {
    const state = user({ switches: { "transport:SMS": false } });
    expect(decidePersonal([state], { typeKey: "job.offer", transport: "SMS" }).allowed).toBe(false);
    expect(decidePersonal([state], { typeKey: "job.offer", transport: "EMAIL" }).allowed).toBe(true);
  });

  it("a login's own off stops it even when the account allows it, and the reverse", () => {
    const own = user({ switches: { all: false } });
    expect(decidePersonal([own, client()], { typeKey: "office.cases", transport: "APP" }).allowed).toBe(false);
    expect(decidePersonal([user(), client({ switches: { "transport:APP": false } })], { typeKey: "office.cases", transport: "APP" }).allowed).toBe(false);
  });
});

describe("existing stores keep their meaning", () => {
  it("all email off (User.allEmailOff) blocks every email, not app or text", () => {
    const state = user({ allEmailOff: true });
    expect(decidePersonal([state], { typeKey: "job.changed", transport: "EMAIL" }).allowed).toBe(false);
    expect(decidePersonal([state], { typeKey: "job.changed", transport: "APP" }).allowed).toBe(true);
  });

  it("an email kind switched off blocks that kind, including a send identified only by its kind", () => {
    const state = user({ disabledEmailKinds: new Set(["case_alert"]) });
    expect(decidePersonal([state], { typeKey: "office.cases", transport: "EMAIL", emailKind: "case_alert" }).allowed).toBe(false);
    expect(decidePersonal([state], { typeKey: "office.cases", transport: "EMAIL", emailKind: "job_reminder" }).allowed).toBe(true);
  });

  it("a kind-only send is off when every type of that kind is switched off", () => {
    const kind = NOTIFICATION_CATALOG.find((entry) => entry.key === "office.cases")!.emailKind!;
    const siblings = NOTIFICATION_CATALOG.filter((entry) => entry.emailKind === kind);
    const allOff = Object.fromEntries(siblings.map((entry) => [typeSwitchId(entry.key, "EMAIL"), false]));
    expect(decidePersonal([user({ switches: allOff })], { typeKey: `email-kind:${kind}`, transport: "EMAIL" }).allowed).toBe(false);
  });

  it("client job updates keep the three events and the preferred channel", () => {
    expect(decidePersonal([client({ events: { enRoute: false, started: true, finished: true } })], { typeKey: "client.job_updates", transport: "EMAIL", clientJobEvent: "enRoute" }).allowed).toBe(false);
    expect(decidePersonal([client({ events: { enRoute: false, started: true, finished: true } })], { typeKey: "client.job_updates", transport: "EMAIL", clientJobEvent: "started" }).allowed).toBe(true);
    expect(decidePersonal([client({ preferredChannel: "SMS" })], { typeKey: "client.job_updates", transport: "EMAIL" }).allowed).toBe(false);
    expect(decidePersonal([client({ preferredChannel: "SMS" })], { typeKey: "client.job_updates", transport: "SMS" }).allowed).toBe(true);
    expect(decidePersonal([client({ preferredChannel: "BOTH" })], { typeKey: "client.job_updates", transport: "EMAIL" }).allowed).toBe(true);
  });

  it("the older client route's channel change switches on before off, so the stored channel stays single", () => {
    expect(legacyClientChanges({ preferredChannel: "SMS" })).toEqual([
      { id: "type:client.job_updates:SMS", on: true },
      { id: "type:client.job_updates:EMAIL", on: false },
    ]);
    expect(legacyClientChanges({ notificationsEnabled: false, notifyOnJobStart: false })).toEqual([
      { id: "all", on: false },
      { id: "event:started", on: false },
    ]);
  });
});

describe("switch ids", () => {
  it("parses only well-formed ids for known types", () => {
    expect(parseSwitchId("all")).toEqual({ kind: "all" });
    expect(parseSwitchId("transport:EMAIL")).toEqual({ kind: "transport", transport: "EMAIL" });
    expect(parseSwitchId("type:job.reminder.scheduled:SMS")).toEqual({ kind: "type", typeKey: "job.reminder.scheduled", transport: "SMS" });
    expect(parseSwitchId("type:not.a.type:SMS")).toBeNull();
    expect(parseSwitchId("transport:PIGEON")).toBeNull();
    expect(parseSwitchId("event:started")).toEqual({ kind: "event", event: "started" });
  });

  it("drops malformed stored values instead of letting them block", () => {
    expect(sanitizeSwitchValues({ all: "no", "transport:SMS": false, "type:bogus:EMAIL": false, nonsense: false })).toEqual({ "transport:SMS": false });
  });

  it("security types are never switchable", () => {
    for (const key of ALWAYS_SENT_TYPES) {
      const entry = NOTIFICATION_CATALOG.find((item) => item.key === key);
      if (entry) expect(fixedReasonFor(entry, true)).toBe("SECURITY");
    }
  });
});
