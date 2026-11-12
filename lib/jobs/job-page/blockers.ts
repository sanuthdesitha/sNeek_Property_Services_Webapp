/**
 * "Before you approve, N things need you" — the blockers listed above the
 * fold, each linking into the stage that resolves it. Built only from facts
 * the server page already holds; checks that run in the browser (AI photo
 * suggestions, draft evidence conflicts) show inside their own stage instead
 * of being guessed here.
 */

export type JobBlocker = { key: string; text: string; href: string };

export type JobBlockerInput = {
  status: string;
  pendingTaskRequests: number;
  pendingContinuations: number;
  /** Job-level clock-in distance from the property pin, in metres (null = not recorded). */
  clockInDistanceM: number | null;
  /** The property's on-site radius (its own override, else the default). */
  geofenceRadiusM: number;
  skipStatus: string;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function jobBlockers(input: JobBlockerInput): JobBlocker[] {
  if (input.status === "CANCELLED") return [];
  const blockers: JobBlocker[] = [];
  if (input.pendingTaskRequests > 0) {
    blockers.push({
      key: "task-requests",
      text: `${plural(input.pendingTaskRequests, "task request", "task requests")} to decide`,
      href: "#s-submitted",
    });
  }
  if (input.pendingContinuations > 0) {
    blockers.push({
      key: "continuations",
      text: `${plural(input.pendingContinuations, "continuation request", "continuation requests")} to decide`,
      href: "#s-site",
    });
  }
  if (input.clockInDistanceM !== null && input.clockInDistanceM > input.geofenceRadiusM) {
    blockers.push({
      key: "gps",
      text: `Clocked in ${Math.round(input.clockInDistanceM)} m from the property`,
      href: "#s-site",
    });
  }
  if (input.skipStatus === "REQUESTED") {
    blockers.push({ key: "skip", text: "The client asked to skip this clean", href: "#s-booking" });
  }
  return blockers;
}

export function blockersHeading(status: string, count: number): string {
  const things = count === 1 ? "1 thing needs you" : `${count} things need you`;
  return status === "SUBMITTED" ? `Before you approve, ${things}:` : `${things.charAt(0).toUpperCase()}${things.slice(1)}:`;
}
