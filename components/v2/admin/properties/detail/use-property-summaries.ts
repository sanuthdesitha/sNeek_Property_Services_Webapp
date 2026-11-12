"use client";

/**
 * Reads the Overview read model (GET /api/admin/properties/:id/overview) and
 * the performance figures (GET /api/admin/properties/:id/stats, the existing
 * endpoint). Each read is aborted when the property changes or a newer read
 * starts; a failed reload keeps the last good answer on screen (stale).
 */
import { useCallback, useEffect, useState } from "react";
import type { PropertyOverview } from "@/lib/properties/preview-types";

export type Remote<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };

function useRemote<T>(url: string, isValid: (body: unknown) => boolean): Remote<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !isValid(body)) {
          throw new Error((body as { error?: string } | null)?.error ?? `Could not load (${response.status}).`);
        }
        setData(body);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Could not load.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { data, loading, error, reload };
}

export function usePropertyOverview(propertyId: string): Remote<PropertyOverview> {
  return useRemote<PropertyOverview>(`/api/admin/properties/${encodeURIComponent(propertyId)}/overview`, (body) => Array.isArray((body as PropertyOverview).comingUp));
}

export type PropertyStatsDto = {
  totalJobs: number;
  jobsLast30d: number;
  jobsLast90d: number;
  jobsLast365d: number;
  lastJobAt: string | null;
  lifetimeValue: number;
  averageJobRating: number | null;
  ratingSampleSize: number;
  recentMediaUrls: string[];
  cleanersWhoServiced: number;
};

export function usePropertyStats(propertyId: string): Remote<PropertyStatsDto> {
  return useRemote<PropertyStatsDto>(`/api/admin/properties/${encodeURIComponent(propertyId)}/stats`, (body) => typeof (body as PropertyStatsDto).totalJobs === "number");
}
