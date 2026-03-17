export type JobTimingPreset = "none" | "11:00" | "12:30" | "custom";

export interface JobReferenceAttachment {
  key: string;
  url: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface JobTimingRule {
  enabled: boolean;
  preset: JobTimingPreset;
  time?: string;
}

export interface JobMeta {
  version: 1;
  internalNoteText: string;
  isDraft: boolean;
  tags: string[];
  attachments: JobReferenceAttachment[];
  earlyCheckin: JobTimingRule;
  lateCheckout: JobTimingRule;
  transportAllowances: Record<string, number>;
}

const DEFAULT_RULE: JobTimingRule = {
  enabled: false,
  preset: "none",
};

export function defaultJobMeta(): JobMeta {
  return {
    version: 1,
    internalNoteText: "",
    isDraft: false,
    tags: [],
    attachments: [],
    earlyCheckin: { ...DEFAULT_RULE },
    lateCheckout: { ...DEFAULT_RULE },
    transportAllowances: {},
  };
}

function normalizeTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^\d{2}:\d{2}$/.test(value) ? value : undefined;
}

function toMinutes(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return undefined;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function normalizeRule(input: unknown): JobTimingRule {
  if (!input || typeof input !== "object") return { ...DEFAULT_RULE };
  const source = input as Record<string, unknown>;
  const preset = source.preset;
  const nextPreset: JobTimingPreset =
    preset === "11:00" || preset === "12:30" || preset === "custom" ? preset : "none";
  return {
    enabled: source.enabled === true && nextPreset !== "none",
    preset: nextPreset,
    time: nextPreset === "custom" ? normalizeTime(source.time) : nextPreset !== "none" ? nextPreset : undefined,
  };
}

export function parseJobInternalNotes(raw: string | null | undefined): JobMeta {
  const fallback = defaultJobMeta();
  if (!raw?.trim()) return fallback;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed?.version !== 1) {
      return { ...fallback, internalNoteText: raw };
    }

    return {
      version: 1,
      internalNoteText:
        typeof parsed.internalNoteText === "string"
          ? parsed.internalNoteText
          : typeof parsed.text === "string"
            ? parsed.text
            : "",
      isDraft: parsed.isDraft === true,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [],
      attachments: Array.isArray(parsed.attachments)
        ? parsed.attachments
            .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
            .map((item) => ({
              key: typeof item.key === "string" ? item.key : "",
              url: typeof item.url === "string" ? item.url : "",
              name: typeof item.name === "string" ? item.name : "Attachment",
              mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
              sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : undefined,
            }))
            .filter((item) => item.key && item.url)
        : [],
      earlyCheckin: normalizeRule(parsed.earlyCheckin),
      lateCheckout: normalizeRule(parsed.lateCheckout),
      transportAllowances:
        parsed.transportAllowances && typeof parsed.transportAllowances === "object"
          ? Object.entries(parsed.transportAllowances as Record<string, unknown>).reduce<Record<string, number>>(
              (acc, [userId, amountRaw]) => {
                const amount = Number(amountRaw);
                if (typeof userId === "string" && userId.trim().length > 0 && Number.isFinite(amount) && amount > 0) {
                  acc[userId.trim()] = Number(amount.toFixed(2));
                }
                return acc;
              },
              {}
            )
          : {},
    };
  } catch {
    return { ...fallback, internalNoteText: raw };
  }
}

export function serializeJobInternalNotes(input: Partial<JobMeta> & { internalNoteText?: string }) {
  const meta = {
    ...defaultJobMeta(),
    ...input,
    internalNoteText: input.internalNoteText ?? "",
    tags: Array.isArray(input.tags)
      ? input.tags.map((tag) => tag.trim()).filter(Boolean)
      : [],
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    earlyCheckin: normalizeRule(input.earlyCheckin),
    lateCheckout: normalizeRule(input.lateCheckout),
    transportAllowances:
      input.transportAllowances && typeof input.transportAllowances === "object"
        ? Object.entries(input.transportAllowances).reduce<Record<string, number>>(
            (acc, [userId, amountRaw]) => {
              const amount = Number(amountRaw);
              if (typeof userId === "string" && userId.trim().length > 0 && Number.isFinite(amount) && amount > 0) {
                acc[userId.trim()] = Number(amount.toFixed(2));
              }
              return acc;
            },
            {}
          )
        : {},
  };

  const hasStructuredData =
    meta.isDraft ||
    meta.tags.length > 0 ||
    meta.attachments.length > 0 ||
    meta.earlyCheckin.enabled ||
    meta.lateCheckout.enabled ||
    Object.keys(meta.transportAllowances).length > 0;

  if (!hasStructuredData) {
    return meta.internalNoteText.trim() || undefined;
  }

  return JSON.stringify({
    version: 1,
    internalNoteText: meta.internalNoteText.trim(),
    isDraft: meta.isDraft,
    tags: meta.tags,
    attachments: meta.attachments,
    earlyCheckin: meta.earlyCheckin,
    lateCheckout: meta.lateCheckout,
    transportAllowances: meta.transportAllowances,
  });
}

export function resolveRuleTime(rule: JobTimingRule): string | undefined {
  if (!rule.enabled) return undefined;
  if (rule.preset === "11:00" || rule.preset === "12:30") return rule.preset;
  return normalizeTime(rule.time);
}

export function getJobTimingHighlights(meta: Pick<JobMeta, "earlyCheckin" | "lateCheckout">) {
  const items: string[] = [];
  const early = resolveRuleTime(meta.earlyCheckin);
  const late = resolveRuleTime(meta.lateCheckout);
  if (late) items.push(`Late checkout: start after ${late}`);
  if (early) items.push(`Early check-in: complete before ${early}`);
  return items;
}

export function applyJobTimingRules(input: {
  startTime?: string | null;
  dueTime?: string | null;
  earlyCheckin: JobTimingRule;
  lateCheckout: JobTimingRule;
}) {
  let startTime = normalizeTime(input.startTime);
  let dueTime = normalizeTime(input.dueTime);
  const early = resolveRuleTime(input.earlyCheckin);
  const late = resolveRuleTime(input.lateCheckout);

  if (late) startTime = late;
  if (early) dueTime = early;

  let hadConflict = false;
  const startM = toMinutes(startTime);
  const dueM = toMinutes(dueTime);
  if (startM !== undefined && dueM !== undefined && dueM < startM) {
    dueTime = startTime;
    hadConflict = true;
  }

  return {
    startTime,
    dueTime,
    hadConflict,
    highlights: getJobTimingHighlights({
      earlyCheckin: input.earlyCheckin,
      lateCheckout: input.lateCheckout,
    }),
  };
}

export function summarizeJobRules(meta: JobMeta) {
  const items: string[] = [];
  if (meta.isDraft) items.push("Draft");
  items.push(...getJobTimingHighlights(meta));

  return items;
}
