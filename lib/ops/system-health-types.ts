/**
 * Shapes of the System health screen (admin Diagnostics). Plain module: the
 * server reader, the route, the pure model and the client screen share it.
 *
 * Facts are what was READ (null = could not be read). The model turns facts
 * into areas with one of five states. Nothing unknown becomes "working",
 * zero or success.
 */

/** Five states, each drawn with its own shape and word. */
export type HealthState = "working" | "attention" | "failing" | "not_set_up" | "unknown";

export type WorkerFacts = {
  /** ACTIVE: a heartbeat in the last 3 minutes. STALE: older. MISSING: never. UNREADABLE: the read failed. */
  status: "ACTIVE" | "STALE" | "MISSING" | "UNREADABLE";
  lastSeenAt: string | null;
  /** Job names the live worker says it registered; null when it did not say. */
  registeredJobs: string[] | null;
};

export type TaskRunFacts = {
  at: string;
  /** null = the run finished but recorded no result (runs before 2026-11-16). */
  ok: boolean | null;
  durationMs: number | null;
  error: string | null;
  skipped: boolean;
};

export type TaskFacts = {
  name: string;
  /** From the stored pg-boss schedule; null when not scheduled. */
  cron: string | null;
  timeZone: string | null;
  lastRun: TaskRunFacts | null;
  lastFailure: TaskRunFacts | null;
  ok24h: number;
  failed24h: number;
  unknown24h: number;
  /** Failures in a row, newest first, from recorded runs. */
  failuresInARow: number;
};

export type QueueFacts = {
  waiting: number;
  running: number;
  willRetry: number;
  failed24h: number;
  doneLastHour: number;
  /** Running for longer than its expiry allows. */
  stuck: number;
};

export type DatabaseFacts = {
  reachable: boolean;
  runningQueries: number | null;
  longestSeconds: number | null;
  /** Text and process ids, admin screen only; never copied for support. */
  activeQueries: Array<{ pid: number; seconds: number; state: string | null; query: string }>;
};

export type XeroFacts = {
  readable: boolean;
  /** No active connection row. */
  notConnected: boolean;
  state: "connected" | "attention" | "reconnect-once" | "needs-reconnect" | null;
  tenantName: string | null;
  lastRefreshedAt: string | null;
  renewBy: string | null;
  reason: string | null;
  lastSyncAt: string | null;
};

export type SafeguardFacts = {
  readable: boolean;
  emergencyStop: boolean;
  /** Active pausing incidents. */
  paused: Array<{ label: string; transport: string | null; since: string }>;
};

/** Counts from the sending log (OutboundMessageEvent) in the last 24 hours. */
export type TransportFacts = {
  /** Provider credentials present. Never the value. */
  keyPresent: boolean | null;
  providerName: string | null;
  handedOver24h: number | null;
  failed24h: number | null;
  notSent24h: number | null;
  /** Allowed but no provider answer recorded yet. */
  pending24h: number | null;
  lastHandedOverAt: string | null;
  lastFailureAt: string | null;
};

export type StorageFacts = {
  keyPresent: boolean | null;
  lastUploadAt: string | null;
  unresolvedFailures: number | null;
  oldestUnresolvedAt: string | null;
};

export type AiFacts = {
  readable: boolean;
  okCalls24h: number;
  failedCalls24h: number;
  lastOkAt: string | null;
  lastOkProvider: string | null;
  lastOkLatencyMs: number | null;
  lastFailureAt: string | null;
};

export type IcalFacts = {
  readable: boolean;
  enabledFeeds: number;
  failing: Array<{ propertyId: string; propertyName: string; since: string | null; error: string | null }>;
  lastRunAt: string | null;
};

export type PaymentFacts = {
  readable: boolean;
  activeGateways: string[];
};

export type HealthFacts = {
  checkedAt: string;
  timeZone: string;
  worker: WorkerFacts;
  /** null = the run history could not be read. */
  tasks: TaskFacts[] | null;
  queue: QueueFacts | null;
  database: DatabaseFacts;
  xero: XeroFacts;
  safeguards: SafeguardFacts;
  email: TransportFacts & { bounceList: number | null };
  sms: TransportFacts;
  push: TransportFacts & { browsers: number | null };
  storage: StorageFacts;
  maps: { keyPresent: boolean | null };
  ai: AiFacts;
  ical: IcalFacts;
  payments: PaymentFacts;
  server: { uptimeSeconds: number; rssMB: number; totalMemMB: number };
};

export type HealthRow = { label: string; value: string };

export type HealthArea = {
  key: string;
  title: string;
  state: HealthState;
  /** The word shown with the shape: "Working", "Key present", "Not tested", "Paused", "Renew by Wed"… */
  word: string;
  /** One line for the area card. */
  short: string;
  /** Detail rows for the outside-services card. */
  rows: HealthRow[];
  note?: string;
  fix?: { label: string; href: string };
  /** Outside services panel (true) or a core area (false). */
  service: boolean;
};

export type AttentionItem = {
  key: string;
  title: string;
  text: string;
  fix?: { label: string; href: string };
};

export type TaskRow = {
  name: string;
  plainName: string;
  description: string;
  runs: string;
  state: HealthState;
  /** "Ok 14:00 · 3.2 s", "Failed 13:30", "No run recorded", "Cannot tell". */
  lastRunText: string;
  lastRunAt: string | null;
  last24h: string;
  nextAt: string | null;
  failure: null | {
    at: string;
    whatHappened: string;
    whatItMeans: string;
    whatToDo: string;
    technical: string;
    fix?: { label: string; href: string };
  };
  intervalMinutes: number | null;
};

export type SystemHealthView = {
  checkedAt: string;
  timeZone: string;
  summary: { needs: number; sentence: string; items: AttentionItem[] };
  areas: HealthArea[];
  tasks: TaskRow[] | null;
  workerNote: string;
  workerKnown: boolean;
  queue: QueueFacts | null;
  database: DatabaseFacts;
  server: HealthFacts["server"];
  emailBounceList: number | null;
  uploadsUnresolved: number | null;
  support: string;
};
