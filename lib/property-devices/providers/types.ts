/** Normalised provider data (2026-11-20). Plain module. */
import type { DeviceKind } from "../types";

export type ProviderLocation = {
  externalLocationId: string;
  name: string;
  address: string | null;
};

export type ProviderDevice = {
  externalDeviceId: string;
  externalLocationId: string | null;
  name: string;
  kind: DeviceKind;
  /** Null when the provider gave no battery level; never 0 for unknown. */
  batteryPercent: number | null;
  batteryPowered: boolean;
  /** Null when the provider does not say. */
  online: boolean | null;
  /** When the battery level was true; null means do not record a reading. */
  readAt: Date | null;
};

export type ProviderSnapshot = { locations: ProviderLocation[]; devices: ProviderDevice[] };
