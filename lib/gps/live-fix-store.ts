"use client";

/**
 * One capture loop per device. The layout tracker (lib/gps/client.tsx) owns
 * the position watch; everything else on the page reads it from here instead
 * of opening its own watch: driving mode's ETA, the driver's route screen
 * (arrival auto-open), the "your location is being shared" indicator.
 *
 * A tiny subscribable store; values are plain data. Nothing here sends.
 */
import type { TrackingState } from "./staleness";

export type LiveFix = { lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null; measuredAt: number };

export type TrackerStatus = {
  /** The tracker is running for a tracked job or route. */
  active: boolean;
  /** "cleaner" or "laundry" while active. */
  portal: "cleaner" | "laundry" | null;
  permission: "prompt" | "granted" | "denied";
  state: TrackingState;
  /** The client can see this cleaner while on the way (their switch is on). */
  clientSees: boolean;
  lastFix: LiveFix | null;
  lastSentAt: number | null;
};

const INITIAL: TrackerStatus = {
  active: false,
  portal: null,
  permission: "prompt",
  state: "SHARING",
  clientSees: false,
  lastFix: null,
  lastSentAt: null,
};

let status: TrackerStatus = INITIAL;
const statusListeners = new Set<(value: TrackerStatus) => void>();
const restartListeners = new Set<() => void>();
const arrivalListeners = new Set<(stop: { taskId: string; kind: string }) => void>();

export function getTrackerStatus(): TrackerStatus {
  return status;
}

export function updateTrackerStatus(patch: Partial<TrackerStatus>): void {
  status = { ...status, ...patch };
  statusListeners.forEach((listener) => listener(status));
}

export function resetTrackerStatus(): void {
  status = INITIAL;
  statusListeners.forEach((listener) => listener(status));
}

export function subscribeTrackerStatus(listener: (value: TrackerStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Ask the tracker to restart its watch (a "Retry location" button). */
export function requestTrackerRestart(): void {
  restartListeners.forEach((listener) => listener());
}

export function subscribeTrackerRestart(listener: () => void): () => void {
  restartListeners.add(listener);
  return () => restartListeners.delete(listener);
}

/** The server stamped arrival at the driver's next stop. */
export function publishRouteArrival(stop: { taskId: string; kind: string }): void {
  arrivalListeners.forEach((listener) => listener(stop));
}

export function subscribeRouteArrival(listener: (stop: { taskId: string; kind: string }) => void): () => void {
  arrivalListeners.add(listener);
  return () => arrivalListeners.delete(listener);
}
