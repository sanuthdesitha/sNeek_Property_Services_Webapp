/**
 * The on/off control in a type's list row, resolved from the EXISTING type
 * controls (no new switch). Plain module (no "use client"): tested directly.
 * - A type with a per-type transport control: on while any transport is on;
 *   off switches every transport off, on switches them all back on.
 * - A type governed by exactly one editable existing switch (an automatic
 *   email kind or a scheduled notification): that switch.
 * - Several switches: a written state; each switch is changed in the details.
 * - No switch: "Office sends" (sent by a person when they choose) or
 *   "Always on".
 */
import type { CatalogTypeView } from "@/lib/notifications/catalog-view-types";
import type { NotificationTransport } from "@/lib/notifications/catalog-types";

export type RowSwitch =
  | { kind: "toggle"; on: boolean; patch: (on: boolean) => unknown }
  | { kind: "badge"; label: string; tone: "ok" | "warn" | "neutral" };

export function rowSwitch(type: CatalogTypeView, controlsUpdatedAt: string | null): RowSwitch {
  if (type.switches.some((item) => item.kind === "TYPE_CONTROL")) {
    const on = type.disabledTransports.length < type.transports.length;
    return {
      kind: "toggle",
      on,
      patch: (next) => ({ controls: { expectedUpdatedAt: controlsUpdatedAt, disabledTransports: { [type.key]: next ? [] : [...type.transports] } } }),
    };
  }
  const editable = type.resolvedSwitches.filter((item) => item.editable && item.enabled !== null);
  if (editable.length === 1) {
    const only = editable[0];
    const [kind, key] = only.id.split(":");
    return {
      kind: "toggle",
      on: only.enabled === true,
      patch: (enabled) => (kind === "email" ? { existingSwitch: { kind: "EMAIL_KIND", emailKind: key, enabled } } : { existingSwitch: { kind: "SCHEDULED", setting: key, enabled } }),
    };
  }
  if (editable.length > 1) {
    const onCount = editable.filter((item) => item.enabled).length;
    if (onCount === editable.length) return { kind: "badge", label: "On", tone: "ok" };
    return onCount === 0 ? { kind: "badge", label: "Off", tone: "warn" } : { kind: "badge", label: "Partly on", tone: "warn" };
  }
  if (type.initiator === "OFFICE_MANUAL") return { kind: "badge", label: "Office sends", tone: "neutral" };
  return { kind: "badge", label: "Always on", tone: "neutral" };
}

/** Whether the type counts as "off" for the list filter. */
export function isTypeOff(type: CatalogTypeView, controlsUpdatedAt: string | null): boolean {
  const state = rowSwitch(type, controlsUpdatedAt);
  return state.kind === "toggle" ? !state.on : state.label === "Off";
}

export type TransportTag = { key: "In" | "Push" | "Email" | "SMS"; on: boolean };

/** Board tags: filled when the transport is used by default and not switched off. */
export function transportTags(type: CatalogTypeView): TransportTag[] {
  const groups: Array<{ key: TransportTag["key"]; members: NotificationTransport[] }> = [
    { key: "In", members: ["INBOX"] },
    { key: "Push", members: ["MOBILE_PUSH", "WEB_PUSH"] },
    { key: "Email", members: ["EMAIL"] },
    { key: "SMS", members: ["SMS"] },
  ];
  return groups.flatMap((group) => {
    const available = group.members.filter((member) => type.transports.includes(member));
    if (!available.length) return [];
    const on = available.some((member) => type.defaultTransports.includes(member) && !type.disabledTransports.includes(member));
    return [{ key: group.key, on }];
  });
}
