/**
 * The wording layer's email parts are block designs (wording-designs.ts).
 * The wording render function still returns the HTML body it always did
 * (callers and the parity tests read it), with the spec the send path uses
 * to render the block design instead: the published version, or version 1
 * converted from these same words. An admin's raw-HTML wording edit from
 * before blocks is marked `custom` and keeps going out (on the base layout)
 * until a block version is published.
 */
import { resolveAppUrl } from "@/lib/app-url";
import { variableDefinition } from "@/lib/notifications/wording/variables";
import { embedSpec } from "./spec";
import { wordingDesignKey } from "./wording-designs";

type Values = Readonly<Record<string, string | number | null | undefined>>;

function valueString(name: string, raw: Values[string]): string {
  const value = raw === null || raw === undefined ? "" : String(raw);
  // Links the app built as paths ("/v2/…") become absolute, as the send path did for href="/…".
  if (variableDefinition(name).format === "url" && value.startsWith("/")) return resolveAppUrl(value);
  return value;
}

export function attachWordingDesign(fragment: string, input: { typeKey: string; partId: string; values: Values; subject: string; custom: boolean }): string {
  const values = Object.fromEntries(Object.entries(input.values).map(([name, raw]) => [name, valueString(name, raw)]));
  return embedSpec(fragment, { v: 1, kind: "design", key: wordingDesignKey(input.typeKey, input.partId), values, subject: input.subject, body: fragment, ...(input.custom ? { custom: true } : {}) });
}
