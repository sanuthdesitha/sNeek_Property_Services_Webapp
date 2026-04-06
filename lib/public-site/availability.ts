import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { canUseNodePrisma } from "@/lib/database-runtime";
import { findServiceSuburb, searchServiceSuburbs } from "@/lib/public-site/suburbs";

const TZ = "Australia/Sydney";

export async function checkSuburbAvailability(suburb: string) {
  const normalized = suburb.trim();
  const matchedSuburb = findServiceSuburb(normalized);

  if (!normalized || !canUseNodePrisma()) {
    return {
      available: matchedSuburb ? matchedSuburb.coverage === "standard" : true,
      message: normalized
        ? matchedSuburb?.coverage === "on_request"
          ? `${matchedSuburb.name} is outside our main Parramatta coverage radius. Contact the team and we can confirm availability for your job.`
          : `We service ${matchedSuburb?.name ?? normalized} and surrounding areas.`
        : "We service Parramatta and Greater Sydney",
      nextSlot: "Next weekday from 8am",
    };
  }

  try {
    const [propertyCount, jobCount] = await Promise.all([
      db.property.count({
        where: { suburb: { contains: normalized, mode: "insensitive" }, isActive: true },
      }),
      db.job.count({
        where: { property: { suburb: { contains: normalized, mode: "insensitive" }, isActive: true } },
      }),
    ]);

    return {
      available: matchedSuburb ? matchedSuburb.coverage === "standard" : true,
      message:
        propertyCount > 0 || jobCount > 0
          ? `We service ${matchedSuburb?.name ?? normalized} and can review the next suitable booking window.`
          : matchedSuburb?.coverage === "on_request"
            ? `${matchedSuburb.name} is outside our main Parramatta service radius. Contact the team and we can confirm availability for your job.`
            : `We cover ${matchedSuburb?.name ?? normalized} and can review the next suitable booking window.`,
      nextSlot: await findNextAvailableSlot(),
    };
  } catch {
    return {
      available: matchedSuburb ? matchedSuburb.coverage === "standard" : true,
      message:
        matchedSuburb?.coverage === "on_request"
          ? `${matchedSuburb.name} is outside our main Parramatta service radius. Contact the team and we can confirm availability for your job.`
          : `We service ${matchedSuburb?.name ?? normalized}`,
      nextSlot: "Next weekday from 8am",
    };
  }
}

export function getAvailabilitySuggestions(query: string) {
  return searchServiceSuburbs(query).map((suburb) => ({
    slug: suburb.slug,
    name: suburb.name,
    postcode: suburb.postcode,
    coverage: suburb.coverage,
  }));
}

export async function findNextAvailableSlot() {
  if (!canUseNodePrisma()) return "Next weekday from 8am";

  try {
    const start = new Date();
    const limitPerDay = 10;
    for (let offset = 0; offset < 21; offset += 1) {
      const current = new Date(start.getTime() + offset * 24 * 60 * 60 * 1000);
      const local = toZonedTime(current, TZ);
      const dayOfWeek = local.getDay();
      if (dayOfWeek === 0) continue;
      const dayStart = new Date(local.getFullYear(), local.getMonth(), local.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const count = await db.job.count({
        where: {
          scheduledDate: { gte: dayStart, lt: dayEnd },
          status: { notIn: [JobStatus.COMPLETED, JobStatus.INVOICED] },
        },
      });
      if (count < limitPerDay) {
        return `${format(local, "EEEE d MMM")} from ${count >= 6 ? "1pm" : "9am"}`;
      }
    }
  } catch {
    return "Next weekday from 8am";
  }

  return "Next weekday from 8am";
}
