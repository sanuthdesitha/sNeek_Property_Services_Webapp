import "server-only";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { NOTIFICATION_CATALOG } from "../catalog";
import { wordingHash } from "./template";
import { wordingDefinition } from "./registry";
import { emailTemplateFields, parseStoredRow, partDefaults, partProblems, readStoredRow, WORDING_KEY_PREFIX, type StoredVersion } from "./store";
import { variableDefinition } from "./variables";
import { entryKey, partFields, type WordingPartDefinition } from "./types";
import type { WordingPartView, WordingSummary, WordingVersionView } from "./view-types";

type Templates = Record<string, { subject: string; html: string }>;

function versionsView(part: WordingPartDefinition, history: StoredVersion[], defaults: ReturnType<typeof partDefaults>): WordingVersionView[] {
  const original: WordingVersionView = { version: 1, savedAt: null, actorName: null, kind: "DEFAULT", change: "Original", fields: defaults };
  return [original, ...history.map((item) => ({
    version: item.version,
    savedAt: item.savedAt,
    actorName: item.actor.name ?? "Unknown",
    kind: item.kind,
    change: item.change || (item.kind === "RESET" ? "Reset to default" : item.kind === "RESTORE" ? "Restored an earlier version" : "Edited"),
    fields: item.fields ?? defaults,
  }))];
}

function partView(part: WordingPartDefinition, history: StoredVersion[], templates: Templates): WordingPartView {
  const defaults = partDefaults(part);
  const last = history[history.length - 1];
  let live = defaults;
  let liveSource: WordingPartView["liveSource"] = "default";
  if (part.source.kind === "EMAIL_TEMPLATE") {
    live = emailTemplateFields(templates, part.source.key);
    const matchesHistory = last ? wordingHash(last.fields ?? defaults) === wordingHash(live) : wordingHash(live) === wordingHash(defaults);
    liveSource = !matchesHistory ? "forms" : last?.fields ? "override" : "default";
  } else if (last?.fields) {
    if (partProblems(part, last.fields).length) liveSource = "invalid";
    else { live = last.fields; liveSource = "override"; }
  }
  const versions = versionsView(part, history, defaults);
  return {
    id: part.id,
    label: part.label,
    transport: part.transport,
    fields: [...partFields(part)],
    variables: part.variables.map(variableDefinition),
    required: [...part.required],
    note: part.note ?? null,
    push: part.push ?? null,
    source: part.source.kind,
    templateKey: part.source.kind === "EMAIL_TEMPLATE" ? part.source.key : null,
    defaults,
    live,
    liveHash: wordingHash(live),
    liveVersion: liveSource === "forms" ? null : last?.version ?? 1,
    liveSource,
    problems: partProblems(part, live).map((problem) => problem.message),
    versions,
  };
}

/** The editor view of one type (all parts, live wording, history). */
export async function readTypeWording(typeKey: string): Promise<{ status: string; reason: string | null; href: string | null; parts: WordingPartView[] } | null> {
  const definition = wordingDefinition(typeKey);
  if (!definition) return null;
  const [row, settings] = await Promise.all([readStoredRow(typeKey), getAppSettings()]);
  return {
    status: definition.status,
    reason: definition.reason ?? null,
    href: definition.href ?? null,
    parts: definition.parts.map((part) => partView(part, row.entries[entryKey(part.id, part.transport)] ?? [], settings.emailTemplates)),
  };
}

/** One line per catalog type for the list: status, edited, live version, problems. */
export async function readWordingSummaries(): Promise<WordingSummary[]> {
  const [rows, settings] = await Promise.all([
    db.appSetting.findMany({ where: { key: { startsWith: WORDING_KEY_PREFIX } }, select: { key: true, value: true } }),
    getAppSettings(),
  ]);
  const byType = new Map(rows.map((row) => [row.key.slice(WORDING_KEY_PREFIX.length), parseStoredRow(row.value)]));
  return NOTIFICATION_CATALOG.map((entry) => {
    const definition = wordingDefinition(entry.key)!;
    const row = byType.get(entry.key) ?? { entries: {} };
    const views = definition.parts.map((part) => partView(part, row.entries[entryKey(part.id, part.transport)] ?? [], settings.emailTemplates));
    return {
      typeKey: entry.key,
      status: definition.status,
      transports: Array.from(new Set(views.map((view) => view.transport))),
      edited: views.some((view) => view.liveSource !== "default"),
      problems: views.reduce((total, view) => total + view.problems.length + (view.liveSource === "invalid" ? 1 : 0), 0),
      liveVersion: Math.max(1, ...views.map((view) => view.liveVersion ?? 1)),
    };
  });
}
