function toMinutes(value: string | null | undefined) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

export function getCleanerScheduleSortMinutes(input: {
  startTime?: string | null;
  dueTime?: string | null;
}) {
  return toMinutes(input.startTime) ?? toMinutes(input.dueTime) ?? 23 * 60 + 59;
}

export function compareCleanerJobsBySchedule<
  T extends {
    scheduledDate: Date;
    startTime?: string | null;
    dueTime?: string | null;
    priorityBucket?: number | null;
    property?: { name?: string | null } | null;
  },
>(left: T, right: T) {
  const dateDelta = left.scheduledDate.getTime() - right.scheduledDate.getTime();
  if (dateDelta !== 0) return dateDelta;

  const timeDelta =
    getCleanerScheduleSortMinutes(left) - getCleanerScheduleSortMinutes(right);
  if (timeDelta !== 0) return timeDelta;

  const bucketDelta = (left.priorityBucket ?? 4) - (right.priorityBucket ?? 4);
  if (bucketDelta !== 0) return bucketDelta;

  return String(left.property?.name ?? "").localeCompare(String(right.property?.name ?? ""));
}

export function buildGoogleMapsDirectionsUrl(input: {
  address?: string | null;
  suburb?: string | null;
  name?: string | null;
}) {
  const parts = [input.address, input.suburb, input.name]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const query = encodeURIComponent(parts.join(", "));
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function buildGoogleMapsMultiStopUrl(addresses: Array<string | null | undefined>) {
  const clean = addresses
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean[0])}`;
  }
  const origin = clean[0];
  const destination = clean[clean.length - 1];
  const waypoints = clean.slice(1, -1).slice(0, 8);
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
