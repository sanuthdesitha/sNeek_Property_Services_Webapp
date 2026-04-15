import { prisma } from "@/lib/db/prisma";

export const LAUNDRY_CONSTANTS = {
  DEFAULT_PICKUP_TIME: "09:00",
  DEFAULT_DROPOFF_TIME: "15:00",
  BAG_WEIGHT_KG: 3.5,
  LINEN_PER_BEDROOM_SETS: 2,
  LINEN_PER_BATHROOM_SETS: 1,
  EXPRESS_TURNOVER_HOURS: 6,
};

export async function generateLaundryTasksForJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { property: true },
  });

  if (!job || !job.property.laundryEnabled) return null;

  const pickupDate = job.scheduledDate;
  const dropoffDate = new Date(pickupDate);
  dropoffDate.setDate(dropoffDate.getDate() + 2); // 2-day turnaround

  return prisma.laundryTask.create({
    data: {
      jobId,
      propertyId: job.propertyId,
      pickupDate,
      dropoffDate,
      bagWeightKg: job.property.bedrooms * LAUNDRY_CONSTANTS.BAG_WEIGHT_KG,
    },
  });
}

export async function generateWeeklyLaundryTasks(startDate: Date, endDate: Date) {
  const jobs = await prisma.job.findMany({
    where: {
      scheduledDate: { gte: startDate, lte: endDate },
      property: { laundryEnabled: true },
    },
    include: { property: true },
  });

  const created = [];
  for (const job of jobs) {
    const existing = await prisma.laundryTask.findUnique({ where: { jobId: job.id } });
    if (!existing) {
      const task = await generateLaundryTasksForJob(job.id);
      if (task) created.push(task);
    }
  }

  return created;
}

export async function getLaundryTasksForDate(date: Date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return prisma.laundryTask.findMany({
    where: {
      OR: [
        { pickupDate: { gte: startOfDay, lte: endOfDay } },
        { dropoffDate: { gte: startOfDay, lte: endOfDay } },
      ],
    },
    include: {
      property: { select: { name: true, address: true, linenBufferSets: true } },
      supplier: true,
      confirmations: true,
    },
    orderBy: { pickupDate: "asc" },
  });
}
