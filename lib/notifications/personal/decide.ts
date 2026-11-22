/**
 * The personal-switch decision for one message, one transport. Pure: the
 * caller loads the subjects' stored switches (resolve.ts) and this decides.
 *
 * A message can concern more than one subject: a client login is both the
 * login (its own switches) and the client account (the account's switches
 * apply to every login and to the client's own address). Any subject that
 * switched the message off blocks it — an opt-out is never outvoted.
 */
import {
  ALL_SWITCH_ID,
  CLIENT_CHANNEL_SWITCH_ID,
  PERSONAL_SKIP_TEXT,
  clientEventSwitchId,
  transportSwitchId,
  typeSwitchId,
  typesSharingEmailKind,
  type ClientJobEvent,
  type PersonalTransport,
  type SwitchValues,
} from "./model";

export const CLIENT_JOB_UPDATES_TYPE = "client.job_updates";

export type UserSubjectState = {
  kind: "USER";
  id: string;
  name: string | null;
  role: string;
  switches: SwitchValues;
  /** "Stop emailing me entirely" (User.allEmailOff). */
  allEmailOff: boolean;
  /** Automatic-email kinds this login switched off (UserEmailPreference). */
  disabledEmailKinds: ReadonlySet<string>;
};

export type ClientChannel = "EMAIL" | "SMS" | "BOTH";

export type ClientSubjectState = {
  kind: "CLIENT";
  id: string;
  name: string | null;
  /** The account's "all notifications" switch (ClientNotificationPreference.notificationsEnabled). */
  notificationsEnabled: boolean;
  events: Record<ClientJobEvent, boolean>;
  preferredChannel: ClientChannel;
  switches: SwitchValues;
};

export type PersonalSubjectState = UserSubjectState | ClientSubjectState;

export type PersonalQuery = {
  /** The catalog type, or a derived key ("email-kind:<kind>", "category:<c>", "unclassified:<t>"). */
  typeKey: string | null;
  transport: PersonalTransport;
  /** The automatic-email kind of an email, when the send declared one. */
  emailKind?: string | null;
  /** For client job updates: which of the three events this is. */
  clientJobEvent?: ClientJobEvent | null;
};

export type PersonalBlock = {
  subjectKind: "USER" | "CLIENT";
  subjectId: string;
  subjectName: string | null;
  switchId: string;
};

export type PersonalDecision = { allowed: boolean; blocks: PersonalBlock[] };

function isOff(values: SwitchValues, id: string): boolean {
  return values[id] === false;
}

/** For a send identified only by its email kind: off when every type of that kind is off. */
function kindOnlyTypeOff(values: SwitchValues, typeKey: string | null): boolean {
  if (!typeKey?.startsWith("email-kind:")) return false;
  const kind = typeKey.slice("email-kind:".length);
  const types = typesSharingEmailKind(kind);
  return types.length > 0 && types.every((entry) => isOff(values, typeSwitchId(entry.key, "EMAIL")));
}

function userBlocks(state: UserSubjectState, query: PersonalQuery): string[] {
  const ids: string[] = [];
  if (isOff(state.switches, ALL_SWITCH_ID)) ids.push(ALL_SWITCH_ID);
  if (query.transport === "EMAIL" ? state.allEmailOff : isOff(state.switches, transportSwitchId(query.transport))) {
    ids.push(transportSwitchId(query.transport));
  }
  if (query.typeKey && isOff(state.switches, typeSwitchId(query.typeKey, query.transport))) {
    ids.push(typeSwitchId(query.typeKey, query.transport));
  }
  if (query.transport === "EMAIL") {
    if (query.emailKind && state.disabledEmailKinds.has(query.emailKind)) ids.push(`emailKind:${query.emailKind}`);
    if (kindOnlyTypeOff(state.switches, query.typeKey)) ids.push(`emailKind:${query.typeKey!.slice("email-kind:".length)}`);
  }
  return ids;
}

function clientBlocks(state: ClientSubjectState, query: PersonalQuery): string[] {
  const ids: string[] = [];
  if (!state.notificationsEnabled) ids.push(ALL_SWITCH_ID);
  if (isOff(state.switches, transportSwitchId(query.transport))) ids.push(transportSwitchId(query.transport));
  if (query.typeKey && isOff(state.switches, typeSwitchId(query.typeKey, query.transport))) {
    ids.push(typeSwitchId(query.typeKey, query.transport));
  }
  if (query.transport === "EMAIL" && kindOnlyTypeOff(state.switches, query.typeKey)) {
    ids.push(`emailKind:${query.typeKey!.slice("email-kind:".length)}`);
  }
  if (query.typeKey === CLIENT_JOB_UPDATES_TYPE) {
    // The account's long-standing job-update choices keep their meaning.
    if (query.transport === "EMAIL" && state.preferredChannel === "SMS") ids.push(CLIENT_CHANNEL_SWITCH_ID);
    if (query.transport === "SMS" && state.preferredChannel === "EMAIL") ids.push(CLIENT_CHANNEL_SWITCH_ID);
    if (query.clientJobEvent && !state.events[query.clientJobEvent]) ids.push(clientEventSwitchId(query.clientJobEvent));
  }
  return ids;
}

export function decidePersonal(states: readonly PersonalSubjectState[], query: PersonalQuery): PersonalDecision {
  const blocks: PersonalBlock[] = [];
  for (const state of states) {
    const ids = state.kind === "USER" ? userBlocks(state, query) : clientBlocks(state, query);
    for (const switchId of ids) blocks.push({ subjectKind: state.kind, subjectId: state.id, subjectName: state.name, switchId });
  }
  return { allowed: blocks.length === 0, blocks };
}

/** The wording recorded for a message the person's own switches stopped. Never "sent". */
export function personalSkipText(blocks: readonly PersonalBlock[]): string {
  const client = blocks.some((block) => block.subjectKind === "CLIENT");
  return client ? PERSONAL_SKIP_TEXT.CLIENT : PERSONAL_SKIP_TEXT.PERSON;
}
