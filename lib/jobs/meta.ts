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

export interface JobServiceContext {
  scopeOfWork?: string;
  accessInstructions?: string;
  parkingInstructions?: string;
  hazardNotes?: string;
  equipmentNotes?: string;
  siteContactName?: string;
  siteContactPhone?: string;
  serviceAreaSqm?: number;
  floorCount?: number;
}

export interface JobReservationContext {
  guestName?: string;
  reservationCode?: string;
  guestPhone?: string;
  guestEmail?: string;
  guestProfileUrl?: string;
  adults?: number;
  children?: number;
  infants?: number;
  preparationGuestCount?: number;
  preparationSource?: "INCOMING_BOOKING" | "PROPERTY_MAX";
  checkinAtLocal?: string;
  checkoutAtLocal?: string;
  locationText?: string;
  geoLat?: number;
  geoLng?: number;
}

export interface JobSpecialRequestTask {
  id: string;
  title: string;
  description?: string;
  requiresPhoto: boolean;
  requiresNote: boolean;
}

export interface JobMeta {
  version: 1;
  internalNoteText: string;
  isDraft: boolean;
  tags: string[];
  attachments: JobReferenceAttachment[];
  specialRequestTasks: JobSpecialRequestTask[];
  earlyCheckin: JobTimingRule;
  lateCheckout: JobTimingRule;
  transportAllowances: Record<string, number>;
  serviceContext?: JobServiceContext;
  reservationContext?: JobReservationContext;
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
    specialRequestTasks: [],
    earlyCheckin: { ...DEFAULT_RULE },
    lateCheckout: { ...DEFAULT_RULE },
    transportAllowances: {},
    serviceContext: undefined,
    reservationContext: undefined,
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

function normalizeServiceContext(input: unknown): JobServiceContext | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const next: JobServiceContext = {};

  const assignString = (key: keyof JobServiceContext) => {
    const raw = source[key];
    if (typeof raw !== "string") return;
    const value = raw.trim();
    if (value) (next as Record<string, string | number | undefined>)[key] = value;
  };

  assignString("scopeOfWork");
  assignString("accessInstructions");
  assignString("parkingInstructions");
  assignString("hazardNotes");
  assignString("equipmentNotes");
  assignString("siteContactName");
  assignString("siteContactPhone");

  const serviceAreaSqm = Number(source.serviceAreaSqm);
  if (Number.isFinite(serviceAreaSqm) && serviceAreaSqm > 0) {
    next.serviceAreaSqm = Number(serviceAreaSqm.toFixed(2));
  }

  const floorCount = Number(source.floorCount);
  if (Number.isFinite(floorCount) && floorCount > 0) {
    next.floorCount = Math.round(floorCount);
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeReservationContext(input: unknown): JobReservationContext | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const next: JobReservationContext = {};

  const assignString = (key: keyof JobReservationContext) => {
    const raw = source[key];
    if (typeof raw !== "string") return;
    const value = raw.trim();
    if (value) (next as Record<string, string | number | undefined>)[key] = value;
  };

  assignString("guestName");
  assignString("reservationCode");
  assignString("guestPhone");
  assignString("guestEmail");
  assignString("guestProfileUrl");
  assignString("checkinAtLocal");
  assignString("checkoutAtLocal");
  assignString("locationText");

  const assignInt = (key: "adults" | "children" | "infants") => {
    const raw = Number(source[key]);
    if (Number.isInteger(raw) && raw >= 0) next[key] = raw;
  };

  assignInt("adults");
  assignInt("children");
  assignInt("infants");

  const preparationGuestCount = Number(source.preparationGuestCount);
  if (Number.isInteger(preparationGuestCount) && preparationGuestCount >= 0) {
    next.preparationGuestCount = preparationGuestCount;
  }

  if (source.preparationSource === "INCOMING_BOOKING" || source.preparationSource === "PROPERTY_MAX") {
    next.preparationSource = source.preparationSource;
  }

  const geoLat = Number(source.geoLat);
  if (Number.isFinite(geoLat)) next.geoLat = Number(geoLat.toFixed(6));
  const geoLng = Number(source.geoLng);
  if (Number.isFinite(geoLng)) next.geoLng = Number(geoLng.toFixed(6));

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeSpecialRequestTasks(input: unknown): JobSpecialRequestTask[] {
  if (!Array.isArray(input)) return [];

  const tasks: JobSpecialRequestTask[] = [];
  input
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .forEach((item, index) => {
      const rawTitle = typeof item.title === "string" ? item.title.trim() : "";
      if (!rawTitle) return;
      const rawId = typeof item.id === "string" ? item.id.trim() : "";
      const rawDescription = typeof item.description === "string" ? item.description.trim() : "";
      tasks.push({
        id: rawId || `admin-task-${index + 1}`,
        title: rawTitle,
        description: rawDescription || undefined,
        requiresPhoto: item.requiresPhoto === true,
        requiresNote: item.requiresNote === true,
      });
    });
  return tasks;
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
      specialRequestTasks: normalizeSpecialRequestTasks(parsed.specialRequestTasks),
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
      serviceContext: normalizeServiceContext(parsed.serviceContext),
      reservationContext: normalizeReservationContext(parsed.reservationContext),
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
    specialRequestTasks: normalizeSpecialRequestTasks(input.specialRequestTasks),
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
    serviceContext: normalizeServiceContext(input.serviceContext),
    reservationContext: normalizeReservationContext(input.reservationContext),
  };

  const hasStructuredData =
    meta.isDraft ||
    meta.tags.length > 0 ||
    meta.attachments.length > 0 ||
    meta.specialRequestTasks.length > 0 ||
    meta.earlyCheckin.enabled ||
    meta.lateCheckout.enabled ||
    Object.keys(meta.transportAllowances).length > 0 ||
    Boolean(meta.serviceContext && Object.keys(meta.serviceContext).length > 0) ||
    Boolean(meta.reservationContext && Object.keys(meta.reservationContext).length > 0);

  if (!hasStructuredData) {
    return meta.internalNoteText.trim() || undefined;
  }

  return JSON.stringify({
    version: 1,
    internalNoteText: meta.internalNoteText.trim(),
    isDraft: meta.isDraft,
    tags: meta.tags,
    attachments: meta.attachments,
    specialRequestTasks: meta.specialRequestTasks,
    earlyCheckin: meta.earlyCheckin,
    lateCheckout: meta.lateCheckout,
    transportAllowances: meta.transportAllowances,
    serviceContext: meta.serviceContext,
    reservationContext: meta.reservationContext,
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

function normalizeHighlightKey(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";

  const timeMatch = normalized.match(/\b(\d{1,2}[:.]\d{2})\b/);
  const normalizedTime = timeMatch ? timeMatch[1].replace(".", ":") : "";

  if (/early check-?in/.test(normalized)) {
    return `early-checkin:${normalizedTime}`;
  }
  if (/late checkout/.test(normalized)) {
    return `late-checkout:${normalizedTime}`;
  }
  if (/same-day check-?in/.test(normalized)) {
    return `same-day-checkin:${normalizedTime}`;
  }
  if (/no same-day check-?in urgency/.test(normalized)) {
    return "no-same-day-checkin-urgency";
  }

  return normalized;
}

export function mergeUniqueJobHighlights(...groups: Array<Array<string | null | undefined> | undefined>) {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const group of groups) {
    for (const raw of group ?? []) {
      if (typeof raw !== "string") continue;
      const value = raw.trim();
      if (!value) continue;
      const key = normalizeHighlightKey(value);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(value);
    }
  }
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
