/** Shapes returned by `/api/admin/notifications/health`. Client-safe. */
import type { WorkerHealth } from "@/lib/ops/worker-heartbeat";
import type { NotificationTransport } from "./catalog-types";
import type { PathBanner } from "./transport-paths";

export type TransportHealth = {
  transport: NotificationTransport;
  configured: boolean | null;
  configuredNote: string;
  enabledNote: string;
  onPipeline: boolean;
  queued: number;
  oldestQueuedAt: string | null;
  failures24h: number;
};

export type NotificationHealth = {
  checkedAt: string;
  transports: TransportHealth[];
  envFlags: Array<{ name: string; value: string; effect: string }>;
  masterSwitches: { email: boolean; sms: boolean; push: boolean; automaticEmail: boolean };
  worker: WorkerHealth & { intentDispatcherActive: boolean | null };
  intentStatusCounts: Record<string, number>;
  banners: PathBanner[];
  unknowns: string[];
};

