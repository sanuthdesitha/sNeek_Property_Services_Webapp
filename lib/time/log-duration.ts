type TimeLogLike = {
  startedAt: Date | string;
  stoppedAt?: Date | string | null;
  durationM?: number | null;
};

function toMillis(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

export function getRecordedTimeLogSeconds(log: TimeLogLike) {
  const startedAtMs = toMillis(log.startedAt);
  const stoppedAtMs = toMillis(log.stoppedAt ?? null);
  if (startedAtMs != null && stoppedAtMs != null && stoppedAtMs >= startedAtMs) {
    return Math.max(0, Math.round((stoppedAtMs - startedAtMs) / 1000));
  }
  return Math.max(0, Math.round(Number(log.durationM ?? 0) * 60));
}

export function getRecordedTimeLogMinutes(log: TimeLogLike) {
  return Math.max(0, Math.round(getRecordedTimeLogSeconds(log) / 60));
}

export function sumRecordedTimeLogSeconds(logs: TimeLogLike[]) {
  return logs.reduce((sum, log) => sum + getRecordedTimeLogSeconds(log), 0);
}

export function sumRecordedTimeLogMinutes(logs: TimeLogLike[]) {
  return Math.max(0, Math.round(sumRecordedTimeLogSeconds(logs) / 60));
}
