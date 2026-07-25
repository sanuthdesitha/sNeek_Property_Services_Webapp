"use client";

/**
 * ESTATE laundry plan brief — compact driver briefing card on the Today page.
 * Feeds from GET /api/laundry/plan-brief: today/tomorrow pickup+drop counts,
 * keyless weather (first stop's coords), a static AM-peak traffic note, NSW
 * public holidays, and drop-deadline warnings ("⚠ Drop X before HH:mm") from
 * the cheap cumulative travel model.
 */
import * as React from "react";
import {
  AlertTriangle,
  CalendarHeart,
  CloudSun,
  PackageOpen,
  TrafficCone,
  Truck,
} from "lucide-react";
import { ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";

type Weather = {
  summary: string;
  wetWeatherGear: boolean;
  precipProbability: number | null;
} | null;

type PlanBrief = {
  counts: {
    today: { pickups: number; drops: number };
    tomorrow: { pickups: number; drops: number };
  };
  weather: { today: Weather; tomorrow: Weather };
  trafficNote: string | null;
  specialDays: {
    today: string | null;
    tomorrow: string | null;
    next: { date: string; name: string; inDays: number } | null;
  };
  deadlineFlags: Array<{
    taskId: string;
    propertyName: string;
    deadline: string;
    projectedArrival: string;
  }>;
};

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[0.8125rem] text-[hsl(var(--e-foreground))]">
      <span className="mt-0.5 shrink-0 text-[hsl(var(--e-accent-portal))]">{icon}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function PlanBrief() {
  const [brief, setBrief] = React.useState<PlanBrief | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/laundry/plan-brief", { cache: "no-store" });
        if (!res.ok) throw new Error("plan brief failed");
        const data = await res.json();
        if (!cancelled) setBrief(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null; // The brief is a nicety — never block the page.

  const special = brief?.specialDays;
  const specialLine = special?.today
    ? `Today is ${special.today} — expect holiday traffic and closed suppliers.`
    : special?.tomorrow
      ? `Tomorrow is ${special.tomorrow} — plan drops accordingly.`
      : special?.next
        ? `${special.next.name} is in ${special.next.inDays} day${special.next.inDays === 1 ? "" : "s"}.`
        : null;

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Plan brief</ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-2">
        {!brief ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Building today&apos;s brief…
          </p>
        ) : (
          <>
            <Line icon={<Truck className="h-4 w-4" />}>
              Today: {brief.counts.today.pickups} pickup
              {brief.counts.today.pickups === 1 ? "" : "s"} · {brief.counts.today.drops} drop
              {brief.counts.today.drops === 1 ? "" : "s"}
            </Line>
            <Line icon={<PackageOpen className="h-4 w-4" />}>
              Tomorrow: {brief.counts.tomorrow.pickups} pickup
              {brief.counts.tomorrow.pickups === 1 ? "" : "s"} · {brief.counts.tomorrow.drops} drop
              {brief.counts.tomorrow.drops === 1 ? "" : "s"}
            </Line>
            {brief.weather.today ? (
              <Line icon={<CloudSun className="h-4 w-4" />}>
                {brief.weather.today.summary}
                {brief.weather.today.wetWeatherGear ? " — bring wet-weather covers" : ""}
                {brief.weather.tomorrow ? (
                  <span className="text-[hsl(var(--e-muted-foreground))]">
                    {" "}
                    · tomorrow {brief.weather.tomorrow.summary}
                  </span>
                ) : null}
              </Line>
            ) : null}
            {brief.trafficNote ? (
              <Line icon={<TrafficCone className="h-4 w-4" />}>{brief.trafficNote}</Line>
            ) : null}
            {specialLine ? (
              <Line icon={<CalendarHeart className="h-4 w-4" />}>{specialLine}</Line>
            ) : null}
            {brief.deadlineFlags.map((flag) => (
              <p
                key={flag.taskId}
                className="flex items-start gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-warning))]/40 bg-[hsl(var(--e-surface-raised))] px-2.5 py-1.5 text-[0.8125rem] font-medium text-[hsl(var(--e-foreground))]"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-warning))]" />
                <span>
                  Drop {flag.propertyName} before {flag.deadline} — projected arrival{" "}
                  {flag.projectedArrival}.
                </span>
              </p>
            ))}
          </>
        )}
      </ECardBody>
    </ECard>
  );
}
