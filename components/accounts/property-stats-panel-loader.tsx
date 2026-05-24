"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PropertyStatsPanel } from "./property-stats-panel";
import type { PropertyStats } from "@/lib/accounts/property-stats";

export function PropertyStatsPanelLoader({ propertyId }: { propertyId: string }) {
  const [stats, setStats] = useState<PropertyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/properties/${propertyId}/stats`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? "Failed to load stats");
          setStats(null);
        } else {
          setStats(body as PropertyStats);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Failed to load stats");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Loading stats…</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !stats) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">{error ?? "Stats unavailable."}</p>
        </CardContent>
      </Card>
    );
  }

  return <PropertyStatsPanel stats={stats} />;
}
