/** Editor views built from the real registry defaults (no server). */
import { wordingDefinition } from "@/lib/notifications/wording/registry";
import { wordingHash } from "@/lib/notifications/wording/template";
import { variableDefinition } from "@/lib/notifications/wording/variables";
import { partFields, type WordingFields } from "@/lib/notifications/wording/types";
import type { TypeWordingResponse, WordingPartView } from "@/lib/notifications/wording/view-types";

export function partViews(typeKey: string, live: Record<string, WordingFields> = {}): WordingPartView[] {
  return (wordingDefinition(typeKey)?.parts ?? []).map((part) => {
    const key = `${part.id}:${part.transport}`;
    const current = live[key] ?? part.defaults;
    const edited = Boolean(live[key]);
    return {
      id: part.id, label: part.label, transport: part.transport, fields: [...partFields(part)],
      variables: part.variables.map(variableDefinition), required: [...part.required], note: part.note ?? null, push: part.push ?? null,
      source: part.source.kind, templateKey: null, defaults: part.defaults, live: current, liveHash: wordingHash(current),
      liveVersion: edited ? 2 : 1, liveSource: edited ? "override" : "default", problems: [],
      versions: [
        { version: 1, savedAt: null, actorName: null, kind: "DEFAULT", change: "Original", fields: part.defaults },
        ...(edited ? [{ version: 2, savedAt: "2026-11-03T01:00:00.000Z", actorName: "Hannah Lee", kind: "EDIT" as const, change: "Edited", fields: current }] : []),
      ],
    };
  });
}

export function manualReminderView(overrides: Partial<TypeWordingResponse> = {}, live: Record<string, WordingFields> = {}): TypeWordingResponse {
  return {
    typeKey: "job.reminder.manual", status: "EDITABLE", reason: null, href: null,
    parts: partViews("job.reminder.manual", live), canEdit: true, editReason: null,
    regenerate: { available: true, reason: null },
    ...overrides,
  };
}
