import { prisma } from "@/lib/db/prisma";
import { createJob } from "@/lib/jobs/service";

const ICAL_REGEX = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
const UID_REGEX = /UID:(.*)/;
const SUMMARY_REGEX = /SUMMARY:(.*)/;
const DTSTART_REGEX = /DTSTART(?:;VALUE=DATE)?:([\dT]+)/;
const DTEND_REGEX = /DTEND(?:;VALUE=DATE)?:([\dT]+)/;

function parseICalDate(dateStr: string): Date {
  const cleaned = dateStr.replace(/[^0-9]/g, "");
  if (cleaned.length === 8) {
    return new Date(
      parseInt(cleaned.slice(0, 4)),
      parseInt(cleaned.slice(4, 6)) - 1,
      parseInt(cleaned.slice(6, 8)),
    );
  }
  return new Date(
    parseInt(cleaned.slice(0, 4)),
    parseInt(cleaned.slice(4, 6)) - 1,
    parseInt(cleaned.slice(6, 8)),
    parseInt(cleaned.slice(8, 10) || "0"),
    parseInt(cleaned.slice(10, 12) || "0"),
    parseInt(cleaned.slice(12, 14) || "0"),
  );
}

export async function fetchAndParseICal(integrationId: string): Promise<{
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    include: { property: true },
  });

  if (!integration || !integration.icalUrl) {
    return { created: 0, updated: 0, deleted: 0, errors: ["No iCal URL configured"] };
  }

  const result = { created: 0, updated: 0, deleted: 0, errors: [] as string[] };

  try {
    const response = await fetch(integration.icalUrl, {
      headers: integration.lastSyncEtag ? { "If-None-Match": integration.lastSyncEtag } : {},
    });

    if (response.status === 304) {
      return { ...result, errors: ["No changes since last sync"] };
    }

    if (!response.ok) {
      return { ...result, errors: [`HTTP ${response.status}: ${response.statusText}`] };
    }

    const icalData = await response.text();
    const etag = response.headers.get("etag") ?? undefined;

    const events = [...icalData.matchAll(ICAL_REGEX)];
    const processedUids = new Set<string>();

    for (const event of events) {
      const eventText = event[1];
      const uid = eventText.match(UID_REGEX)?.[1]?.trim();
      if (!uid) continue;

      processedUids.add(uid);

      const startDate = eventText.match(DTSTART_REGEX)?.[1];
      const endDate = eventText.match(DTEND_REGEX)?.[1];
      const summary = eventText.match(SUMMARY_REGEX)?.[1]?.trim();

      if (!startDate || !endDate) continue;

      const existing = await prisma.reservation.findUnique({
        where: { propertyId_uid: { propertyId: integration.propertyId, uid } },
      });

      const reservationData = {
        uid,
        startDate: parseICalDate(startDate),
        endDate: parseICalDate(endDate),
        summary: summary ?? null,
        guestName: summary?.split(" ")?.[0] ?? null,
        source: "ical",
      };

      if (existing) {
        await prisma.reservation.update({
          where: { id: existing.id },
          data: reservationData,
        });
        result.updated++;
      } else {
        await prisma.reservation.create({
          data: {
            ...reservationData,
            propertyId: integration.propertyId,
          },
        });
        result.created++;
      }
    }

    // Update integration sync status
    await prisma.integration.update({
      where: { id: integrationId },
      data: {
        lastSyncAt: new Date(),
        lastSyncEtag: etag,
        syncStatus: "SUCCESS",
        syncError: null,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(errorMessage);

    await prisma.integration.update({
      where: { id: integrationId },
      data: {
        syncStatus: "ERROR",
        syncError: errorMessage,
      },
    });
  }

  return result;
}

export async function undoICalSync(syncRunId: string, revertedById: string) {
  const syncRun = await prisma.icalSyncRun.findUnique({
    where: { id: syncRunId },
    include: { property: true },
  });

  if (!syncRun || !syncRun.snapshot) {
    throw new Error("Cannot undo: no snapshot available");
  }

  const snapshot = syncRun.snapshot as { created: string[]; updated: string[]; deleted: string[] };

  // Delete created reservations
  if (snapshot.created?.length) {
    await prisma.reservation.deleteMany({
      where: { id: { in: snapshot.created } },
    });
  }

  // Restore updated reservations (would need full snapshot data)
  // This is a simplified version

  await prisma.icalSyncRun.update({
    where: { id: syncRunId },
    data: {
      revertedAt: new Date(),
      revertedById,
    },
  });
}
