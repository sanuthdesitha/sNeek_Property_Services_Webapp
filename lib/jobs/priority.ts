import { resolveRuleTime, type JobTimingRule } from "@/lib/jobs/meta";

function toMinutes(value: string | null | undefined) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

export function classifySameDayCheckinPriority(input: {
  sameDayCheckin?: boolean;
  sameDayCheckinTime?: string | null;
}) {
  const sameDayCheckin = input.sameDayCheckin === true && Boolean(input.sameDayCheckinTime);
  const sameDayCheckinTime = sameDayCheckin ? input.sameDayCheckinTime ?? null : null;

  if (!sameDayCheckin || !sameDayCheckinTime) {
    return {
      sameDayCheckin: false,
      sameDayCheckinTime: null,
      priorityBucket: 4,
      priorityReason: "No same-day check-in urgency",
    };
  }

  const minutes = toMinutes(sameDayCheckinTime);
  if (minutes !== null && minutes <= 12 * 60 + 30) {
    return {
      sameDayCheckin: true,
      sameDayCheckinTime,
      priorityBucket: 1,
      priorityReason: `Early check-in due by ${sameDayCheckinTime}`,
    };
  }

  if (minutes !== null && minutes <= 15 * 60) {
    return {
      sameDayCheckin: true,
      sameDayCheckinTime,
      priorityBucket: 2,
      priorityReason: `Same-day check-in due by ${sameDayCheckinTime}`,
    };
  }

  return {
    sameDayCheckin: true,
    sameDayCheckinTime,
    priorityBucket: 3,
    priorityReason: `Same-day check-in scheduled for ${sameDayCheckinTime}`,
  };
}

export function classifyPriorityFromTimingRule(rule: JobTimingRule) {
  const time = resolveRuleTime(rule);
  return classifySameDayCheckinPriority({
    sameDayCheckin: Boolean(time),
    sameDayCheckinTime: time ?? null,
  });
}

export function compareJobsByPriority<
  T extends {
    scheduledDate: Date;
    priorityBucket?: number | null;
    dueTime?: string | null;
    startTime?: string | null;
    property?: { name?: string | null } | null;
  },
>(left: T, right: T) {
  const dateDelta = left.scheduledDate.getTime() - right.scheduledDate.getTime();
  if (dateDelta !== 0) return dateDelta;

  const bucketDelta = (left.priorityBucket ?? 4) - (right.priorityBucket ?? 4);
  if (bucketDelta !== 0) return bucketDelta;

  const dueDelta = (toMinutes(left.dueTime) ?? 23 * 60 + 59) - (toMinutes(right.dueTime) ?? 23 * 60 + 59);
  if (dueDelta !== 0) return dueDelta;

  const startDelta = (toMinutes(left.startTime) ?? 23 * 60 + 59) - (toMinutes(right.startTime) ?? 23 * 60 + 59);
  if (startDelta !== 0) return startDelta;

  return String(left.property?.name ?? "").localeCompare(String(right.property?.name ?? ""));
}
