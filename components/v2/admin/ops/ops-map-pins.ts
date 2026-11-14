/**
 * Live ops map pin model (pure, client-safe, no Google types).
 *
 * Turns what the Live ops feed already holds — position pings, laundry
 * drivers, today's board rows and the geocoded properties — into labelled
 * pins as drawn in the approved designs (LiveOps / M-CalendarLiveOps `.pin`):
 * a white pill with a round initials badge coloured by the person's state,
 * the short name and a short status only when it matters.
 *
 * Every meaning the old circle markers carried is kept and written down:
 *  - freshness tier of the fix (live / aging / stale) → badge strength, and
 *    "stale fix" in the label when stale;
 *  - approximate fix (± over 100 m) → dashed pill border, "approx." in the label;
 *  - no GPS, shown at the job address → hollow badge, "no GPS" in the label;
 *  - started without a location fix → "no location fix" status;
 *  - selected → ring (and aria-pressed on the button).
 * Colour is never the only signal: `ariaLabel` says the whole state.
 *
 * Overlap: people closer than one pill on screen are stacked into one group,
 * deterministically (most urgent first, then by key).
 */
import { formatRelativeAgo } from "@/lib/ops/live-status";
import { isApproximateFix, locationFreshness, trackingStateLabel, type LocationFreshness } from "@/lib/gps/staleness";
import type { LivePing } from "@/lib/ops/live-feed-types";
import type { LiveDriverRow, LiveJobRow, LiveJobState } from "@/lib/ops/live-board-types";

// ── Types ──────────────────────────────────────────────────────────────────

/** Badge colour, from the Estate status tokens (success, danger, …). */
export type PinTone = "success" | "danger" | "warning" | "info" | "gold" | "neutral";

/** How the drawn position was obtained. */
export type PinPrecision = "gps" | "approximate" | "job-address";

export type PersonPinKind = "cleaner" | "driver";

export type PersonPin = {
  /** The person's user id (what `onSelect` receives). */
  key: string;
  kind: PersonPinKind;
  lat: number;
  lng: number;
  initials: string;
  /** "Aiko T." for a cleaner, "Driver Tom S." for a driver. */
  shortName: string;
  /** Short state shown after the name ("18 min late"); null when nothing to say. */
  status: string | null;
  /** Short position qualifier ("stale fix", "approx.", "no GPS"); null for a good fix. */
  qualifier: string | null;
  tone: PinTone;
  /** Late: red border and text on the whole pill, as drawn. */
  alert: boolean;
  /** Freshness of the fix; "none" for a job-address position. */
  freshness: LocationFreshness;
  precision: PinPrecision;
  selected: boolean;
  /** Lower sorts first inside an overlap group (most urgent on the point). */
  rank: number;
  /** One sentence with every state the pill shows. */
  ariaLabel: string;
};

export type PropertyPinInput = {
  name: string;
  suburb?: string | null;
  lat: number;
  lng: number;
  jobId?: string | null;
  status?: string | null;
};

export type PropertyPin = {
  key: string;
  name: string;
  suburb: string | null;
  lat: number;
  lng: number;
  /** Today's job state from the board, when one of today's jobs is at this property. */
  todayState: LiveJobState | null;
  /** Short words for todayState ("on site", "late"); null without a job today. */
  todayLabel: string | null;
  /** The board job id behind todayState (for the info window's "Open job"). */
  todayJobId: string | null;
  ariaLabel: string;
};

export type PinGroup<T extends { key: string }> = {
  /** Stable for the same members: their keys, sorted, joined. */
  id: string;
  /** The first (most urgent) member's position: the group is drawn there. */
  lat: number;
  lng: number;
  members: T[];
};

// ── Names ──────────────────────────────────────────────────────────────────

function words(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

/** "Aiko Tanaka" → "AT"; "Aiko" → "AI"; "" → "?". Letters only, upper case. */
export function pinInitials(name: string | null | undefined): string {
  const parts = words(name ?? "").map((part) => part.replace(/[^0-9A-Za-z\u00C0-\uFFFF]/g, "")).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SHORT_NAME_MAX = 16;

/** "Aiko Tanaka" → "Aiko T."; "Aiko T." stays; one word stays; long names are cut. */
export function pinShortName(name: string | null | undefined): string {
  const parts = words(name ?? "");
  if (parts.length === 0) return "Unknown";
  const short = parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
  return short.length > SHORT_NAME_MAX ? `${short.slice(0, SHORT_NAME_MAX - 1)}…` : short;
}

function personName(ping: LivePing): string {
  return ping.user?.name?.trim() || ping.userId.slice(0, 8);
}

// ── Cleaner state ──────────────────────────────────────────────────────────

/** Most actionable first; the board uses the same order for a job's state. */
const STATE_ORDER: LiveJobState[] = ["late", "off-site", "not-started", "travelling", "on-site", "planned", "done"];

type BoardPersonState = { state: LiveJobState; minutes: number | null; startedWithoutFix: boolean };

/**
 * A cleaner's own state on today's board: their `cleanerStates` entry, or the
 * row's state when the row has no per-cleaner states. The most actionable
 * state wins when they are on several jobs.
 */
export function boardStateFor(userId: string, jobs: LiveJobRow[]): BoardPersonState | null {
  let best: BoardPersonState | null = null;
  for (const job of jobs) {
    let candidate: BoardPersonState | null = null;
    if (job.cleanerStates && job.cleanerStates.length > 0) {
      const own = job.cleanerStates.find((entry) => entry.userId === userId);
      if (own) candidate = { state: own.state, minutes: own.minutes ?? job.minutes, startedWithoutFix: own.startedWithoutFix === true };
    } else if (job.cleaners.some((cleaner) => cleaner.id === userId)) {
      candidate = { state: job.state, minutes: job.minutes, startedWithoutFix: false };
    }
    if (candidate && (!best || STATE_ORDER.indexOf(candidate.state) < STATE_ORDER.indexOf(best.state))) best = candidate;
  }
  return best;
}

type StateLook = { tone: PinTone; status: string | null; alert: boolean; rank: number; longStatus: string };

function lookFromBoard(board: BoardPersonState): StateLook {
  switch (board.state) {
    case "late": {
      const status = board.minutes != null ? `${Math.round(board.minutes)} min late` : "late";
      return { tone: "danger", status, alert: true, rank: 0, longStatus: status };
    }
    case "off-site":
      return { tone: "warning", status: "off site", alert: false, rank: 1, longStatus: "off site with the clock running" };
    case "not-started":
      return { tone: "neutral", status: "not started", alert: false, rank: 2, longStatus: "not started" };
    case "travelling":
      return { tone: "info", status: "on the way", alert: false, rank: 3, longStatus: "on the way" };
    case "on-site":
      return { tone: "success", status: null, alert: false, rank: 4, longStatus: "on site" };
    case "planned":
      return { tone: "neutral", status: null, alert: false, rank: 5, longStatus: "job planned" };
    default:
      return { tone: "neutral", status: null, alert: false, rank: 6, longStatus: "done for now" };
  }
}

function lookFromLiveStatus(ping: LivePing): StateLook {
  switch (ping.liveStatus) {
    case "EN_ROUTE":
      return { tone: "info", status: "on the way", alert: false, rank: 3, longStatus: "on the way" };
    case "ON_SITE":
      return { tone: "success", status: null, alert: false, rank: 4, longStatus: "on site" };
    case "OFF_SITE":
      return { tone: "warning", status: "off site", alert: false, rank: 1, longStatus: "clocked in, off site" };
    case "LEFT_SITE":
      return { tone: "warning", status: "left site", alert: false, rank: 1, longStatus: "left site" };
    case "UNCERTAIN":
      return { tone: "warning", status: "location unsure", alert: false, rank: 2, longStatus: "clocked in, location approximate" };
    case "NO_SIGNAL":
      return { tone: "neutral", status: "no signal", alert: false, rank: 2, longStatus: "clocked in, no signal" };
    case "PAUSED":
      return { tone: "neutral", status: "paused", alert: false, rank: 5, longStatus: "paused" };
    default:
      return { tone: "neutral", status: null, alert: false, rank: 6, longStatus: "idle" };
  }
}

const NO_FIX_LOOK: StateLook = { tone: "neutral", status: "no location fix", alert: false, rank: 2, longStatus: "clocked in, started without a location fix" };

// ── Position quality ───────────────────────────────────────────────────────

type PositionLook = { precision: PinPrecision; freshness: LocationFreshness; qualifier: string | null; sentence: string };

function positionLook(input: { source: LivePing["positionSource"] | "gps"; measuredAt: string | null; accuracy: number | null; now: number }): PositionLook {
  if (input.source === "property") {
    return { precision: "job-address", freshness: "none", qualifier: "no GPS", sentence: "No GPS yet, shown at the job address" };
  }
  const freshness = locationFreshness(input.measuredAt, input.now);
  if (freshness === "none") {
    // A position without a measured time is treated as stale, as before.
    return { precision: "gps", freshness, qualifier: "stale fix", sentence: "Stale position, time of the fix unknown" };
  }
  const approximate = isApproximateFix(input.accuracy);
  const accuracy = input.accuracy != null ? `, ±${Math.round(input.accuracy)} m` : "";
  const age = `last fix ${formatRelativeAgo(input.measuredAt, input.now)}${accuracy}`;
  const freshnessWord = freshness === "live" ? "Live position" : freshness === "aging" ? "Position aging" : "Stale position";
  const qualifier = freshness === "stale" ? "stale fix" : approximate ? "approx." : null;
  const sentence = `${freshnessWord}${approximate ? ", approximate (over 100 m)" : ""}, ${age}`;
  return { precision: approximate ? "approximate" : "gps", freshness, qualifier, sentence };
}

// ── People pins ────────────────────────────────────────────────────────────

export function cleanerPin(ping: LivePing, jobs: LiveJobRow[], selectedUserId: string | null, now: number): PersonPin | null {
  if (typeof ping.lat !== "number" || typeof ping.lng !== "number") return null;
  const name = personName(ping);
  const board = boardStateFor(ping.userId, jobs);
  const noFix = ping.startedWithoutFix === true || board?.startedWithoutFix === true;
  const look = noFix ? NO_FIX_LOOK : board ? lookFromBoard(board) : lookFromLiveStatus(ping);
  const position = positionLook({ source: ping.positionSource ?? "gps", measuredAt: ping.timestamp, accuracy: ping.accuracy ?? null, now });
  // "no location fix" already says why there is no GPS position.
  const qualifier = noFix && position.precision === "job-address" ? null : position.qualifier;
  const selected = ping.userId === selectedUserId;
  const reason = trackingStateLabel(ping.trackingState);
  const job = ping.activeJob ? ` Job: ${ping.activeJob.propertyName}.` : "";
  const ariaLabel = `${name}, cleaner: ${look.longStatus}.${job} ${position.sentence}.${reason ? ` Phone reports: ${reason}.` : ""}${selected ? " Selected." : ""}`;
  return {
    key: ping.userId,
    kind: "cleaner",
    lat: ping.lat,
    lng: ping.lng,
    initials: pinInitials(name),
    shortName: pinShortName(name),
    status: look.status,
    qualifier,
    tone: look.tone,
    alert: look.alert,
    freshness: position.freshness,
    precision: position.precision,
    selected,
    rank: look.rank,
    ariaLabel,
  };
}

export function driverPin(driver: LiveDriverRow, selectedUserId: string | null, now: number): PersonPin | null {
  if (driver.lat == null || driver.lng == null) return null;
  const first = words(driver.name)[0] ?? "";
  const position = positionLook({ source: "gps", measuredAt: driver.lastPingAt, accuracy: driver.accuracy ?? null, now });
  const selected = driver.userId === selectedUserId;
  const reason = trackingStateLabel(driver.trackingState ?? null);
  const stop = Math.min(driver.stopsDone + 1, driver.stopsTotal);
  const ariaLabel = `${driver.name}, laundry driver: stop ${stop} of ${driver.stopsTotal}. ${position.sentence}.${reason ? ` Phone reports: ${reason}.` : ""}${selected ? " Selected." : ""}`;
  return {
    key: driver.userId,
    kind: "driver",
    lat: driver.lat,
    lng: driver.lng,
    initials: (first[0] ?? "D").toUpperCase(),
    shortName: `Driver ${pinShortName(driver.name)}`,
    status: null,
    qualifier: position.qualifier,
    tone: "gold",
    alert: false,
    freshness: position.freshness,
    precision: position.precision,
    selected,
    rank: 3,
    ariaLabel,
  };
}

/** The text after the badge: "Aiko T. · 18 min late · stale fix". */
export function pinLabel(pin: Pick<PersonPin, "shortName" | "status" | "qualifier">): string {
  return [pin.shortName, pin.status, pin.qualifier].filter(Boolean).join(" · ");
}

export function buildPersonPins(input: {
  pings: LivePing[];
  drivers: LiveDriverRow[];
  jobs: LiveJobRow[];
  showCleaners: boolean;
  showDrivers: boolean;
  selectedUserId: string | null;
  now: number;
}): PersonPin[] {
  const pins: PersonPin[] = [];
  if (input.showCleaners) {
    for (const ping of input.pings) {
      const pin = cleanerPin(ping, input.jobs, input.selectedUserId, input.now);
      if (pin) pins.push(pin);
    }
  }
  if (input.showDrivers) {
    for (const driver of input.drivers) {
      const pin = driverPin(driver, input.selectedUserId, input.now);
      if (pin) pins.push(pin);
    }
  }
  return pins;
}

// ── Overlap grouping ───────────────────────────────────────────────────────

const TILE = 256;

/** Web Mercator world pixel at a zoom level (what Google Maps draws). */
export function worldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/**
 * The space one pill takes on screen around its anchor (the badge centre):
 * a label of about `width` to the right, one row of `height` per stacked pin.
 */
export const PIN_OVERLAP_BOX = { width: 120, height: 30 };
/** From the badge centre to the pill's left and bottom edges. */
const BADGE_HALF = 13;

function comparePins<T extends { key: string; rank?: number }>(a: T, b: T): number {
  const rank = (a.rank ?? 0) - (b.rank ?? 0);
  return rank !== 0 ? rank : a.key.localeCompare(b.key);
}

type DraftGroup<T> = { anchor: { x: number; y: number }; lat: number; lng: number; members: T[] };

/** Screen box a collapsed group occupies: its stack grows upwards from the anchor. */
function groupBox<T>(group: DraftGroup<T>, box: { width: number; height: number }) {
  const rows = Math.min(group.members.length, GROUP_VISIBLE_MAX);
  return {
    left: group.anchor.x - BADGE_HALF,
    right: group.anchor.x + box.width,
    top: group.anchor.y - BADGE_HALF - (rows - 1) * box.height,
    bottom: group.anchor.y + BADGE_HALF,
  };
}

function boxesOverlap(a: ReturnType<typeof groupBox>, b: ReturnType<typeof groupBox>): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Groups pins that would cover each other at this zoom. Deterministic: every
 * pin starts as its own group, most urgent first (then by key); while two
 * groups' screen boxes overlap, the later group joins the earlier one, which
 * keeps its anchor (its most urgent person stays on their own point).
 */
export function groupOverlappingPins<T extends { key: string; lat: number; lng: number; rank?: number }>(
  pins: T[],
  zoom: number,
  box: { width: number; height: number } = PIN_OVERLAP_BOX,
): PinGroup<T>[] {
  const groups: DraftGroup<T>[] = [...pins].sort(comparePins).map((pin) => ({
    anchor: worldPixel(pin.lat, pin.lng, zoom),
    lat: pin.lat,
    lng: pin.lng,
    members: [pin],
  }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        if (!boxesOverlap(groupBox(groups[i], box), groupBox(groups[j], box))) continue;
        groups[i].members = [...groups[i].members, ...groups[j].members].sort(comparePins);
        groups.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return groups.map((group) => ({
    id: group.members.map((member) => member.key).sort().join("|"),
    lat: group.lat,
    lng: group.lng,
    members: group.members,
  }));
}

/** A collapsed group shows this many pins, or this many minus one and "+N". */
export const GROUP_VISIBLE_MAX = 3;

/**
 * Which members a group shows. Up to GROUP_VISIBLE_MAX are all shown; a
 * larger collapsed group shows the first two and "+N". The selected person is
 * always shown (in the last visible slot when they would be hidden).
 */
export function visibleGroupMembers<T extends { key: string }>(
  group: PinGroup<T>,
  expanded: boolean,
  selectedKey: string | null,
  max: number = GROUP_VISIBLE_MAX,
): { visible: T[]; hiddenCount: number } {
  if (expanded || group.members.length <= max) return { visible: group.members, hiddenCount: 0 };
  const visible = group.members.slice(0, max - 1);
  const selected = selectedKey ? group.members.find((member) => member.key === selectedKey) : undefined;
  if (selected && !visible.includes(selected)) visible[visible.length - 1] = selected;
  return { visible, hiddenCount: group.members.length - visible.length };
}

// ── Properties ─────────────────────────────────────────────────────────────

/** Property names are drawn from this zoom (a street-level view) without a job today. */
export const PROPERTY_LABEL_MIN_ZOOM = 15;

const PROPERTY_STATE_WORDS: Record<LiveJobState, string> = {
  late: "cleaner late",
  "off-site": "cleaner off site",
  "not-started": "not started",
  travelling: "cleaner on the way",
  "on-site": "cleaner on site",
  planned: "job today",
  done: "done today",
};

function normalise(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Property pins with today's job state taken from the board rows already in
 * the feed (no extra query). The board names the property, not its id, so a
 * row is matched by name and suburb; a row without a suburb matches only a
 * property whose name is unique. An ambiguous match is left undecorated.
 */
export function buildPropertyPins(properties: PropertyPinInput[], jobs: LiveJobRow[]): PropertyPin[] {
  const nameCounts = new Map<string, number>();
  for (const property of properties) nameCounts.set(normalise(property.name), (nameCounts.get(normalise(property.name)) ?? 0) + 1);
  return properties.map((property, index) => {
    const name = normalise(property.name);
    const suburb = normalise(property.suburb);
    let best: LiveJobRow | null = null;
    for (const job of jobs) {
      if (normalise(job.propertyName) !== name) continue;
      const jobSuburb = normalise(job.suburb);
      const matches = jobSuburb ? jobSuburb === suburb : nameCounts.get(name) === 1;
      if (!matches) continue;
      if (!best || STATE_ORDER.indexOf(job.state) < STATE_ORDER.indexOf(best.state)) best = job;
    }
    const todayLabel = best ? PROPERTY_STATE_WORDS[best.state] : null;
    const place = property.suburb ? `${property.name}, ${property.suburb}` : property.name;
    return {
      key: `p:${index}:${property.lat.toFixed(5)}:${property.lng.toFixed(5)}`,
      name: property.name,
      suburb: property.suburb ?? null,
      lat: property.lat,
      lng: property.lng,
      todayState: best?.state ?? null,
      todayLabel,
      todayJobId: property.jobId ?? best?.jobId ?? null,
      ariaLabel: `Property: ${place}. ${todayLabel ? `Today: ${todayLabel}.` : "No job on today's board."}`,
    };
  });
}

/** Whether a property pin carries its name at this zoom. */
export function showPropertyLabel(pin: Pick<PropertyPin, "todayState">, zoom: number): boolean {
  return pin.todayState !== null || zoom >= PROPERTY_LABEL_MIN_ZOOM;
}
