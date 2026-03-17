export type IssueCaseType = "LOST_FOUND" | "DAMAGE" | "SLA" | "OTHER";

export type IssueCaseMetadata = {
  assigneeUserId?: string | null;
  dueAt?: string | null;
  tags?: string[];
};

export type IssueCaseUpdate = {
  atLabel: string;
  actorLabel: string;
  note: string;
};

const META_START = "[CASE_META]";
const META_END = "[/CASE_META]";

const UPDATE_HEADER_REGEX = /^\[(.+?)\]\s+(.+?):\s*$/;

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const raw of input) {
    const tag = String(raw ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    if (tag) set.add(tag);
  }
  return Array.from(set).slice(0, 20);
}

function sanitizeMetadata(input: unknown): IssueCaseMetadata {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const assigneeUserId =
    typeof source.assigneeUserId === "string" && source.assigneeUserId.trim().length > 0
      ? source.assigneeUserId.trim()
      : null;
  const dueAt =
    typeof source.dueAt === "string" && source.dueAt.trim().length > 0
      ? source.dueAt.trim()
      : null;
  const tags = normalizeTags(source.tags);
  return {
    assigneeUserId,
    dueAt,
    tags,
  };
}

function isMetadataEmpty(meta: IssueCaseMetadata): boolean {
  return !meta.assigneeUserId && !meta.dueAt && (!meta.tags || meta.tags.length === 0);
}

export function getIssueCaseType(title: string): IssueCaseType {
  const normalized = title.trim().toLowerCase();
  if (normalized.startsWith("lost & found:")) return "LOST_FOUND";
  if (normalized.startsWith("damage:")) return "DAMAGE";
  if (normalized.startsWith("sla breach")) return "SLA";
  return "OTHER";
}

export function parseCaseDescription(rawDescription: string | null | undefined): {
  text: string;
  metadata: IssueCaseMetadata;
  evidenceKeys: string[];
  updates: IssueCaseUpdate[];
  summary: string;
} {
  const raw = String(rawDescription ?? "");
  const metaStart = raw.lastIndexOf(META_START);
  const metaEnd = raw.lastIndexOf(META_END);

  let text = raw;
  let metadata: IssueCaseMetadata = {};
  if (metaStart >= 0 && metaEnd > metaStart) {
    const jsonText = raw.slice(metaStart + META_START.length, metaEnd).trim();
    try {
      metadata = sanitizeMetadata(JSON.parse(jsonText));
    } catch {
      metadata = {};
    }
    text = `${raw.slice(0, metaStart)}${raw.slice(metaEnd + META_END.length)}`.trim();
  }

  const lines = text.split(/\r?\n/);
  const updates: IssueCaseUpdate[] = [];
  const evidenceKeys: string[] = [];
  const seenEvidence = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const updateHeader = line.match(UPDATE_HEADER_REGEX);
    if (updateHeader) {
      const atLabel = updateHeader[1]?.trim() || "Unknown time";
      const actorLabel = updateHeader[2]?.trim() || "Unknown actor";
      const noteLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (UPDATE_HEADER_REGEX.test(next.trim())) break;
        noteLines.push(next);
        j += 1;
      }
      const note = noteLines.join("\n").trim();
      updates.push({
        atLabel,
        actorLabel,
        note: note || "(No note text)",
      });
      i = j - 1;
      continue;
    }

    const evidenceMatch = line.match(/^\-\s*([A-Za-z0-9/_\-.]+)$/);
    if (evidenceMatch) {
      const key = evidenceMatch[1] ?? "";
      const maybeUploadKey = key.includes("/") && !key.includes("..");
      if (maybeUploadKey && !seenEvidence.has(key)) {
        seenEvidence.add(key);
        evidenceKeys.push(key);
      }
    }
  }

  const summary = text.split(/\n{2,}/).find((part) => part.trim().length > 0)?.trim() ?? "";
  return {
    text,
    metadata,
    evidenceKeys,
    updates,
    summary,
  };
}

export function composeCaseDescription(input: {
  text: string;
  metadata?: IssueCaseMetadata;
}): string {
  const base = String(input.text ?? "").trim();
  const metadata = sanitizeMetadata(input.metadata ?? {});
  if (isMetadataEmpty(metadata)) return base;
  const serializedMeta = JSON.stringify(metadata);
  if (!base) {
    return `${META_START}${serializedMeta}${META_END}`;
  }
  return `${base}\n\n${META_START}${serializedMeta}${META_END}`;
}
