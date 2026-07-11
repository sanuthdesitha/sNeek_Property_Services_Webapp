"use client";

/**
 * Route surface with two native modes: "Drive" (live en-route control + GPS
 * heartbeat, DrivingMode) and "Timeline" (the full ordered day with navigation
 * deep links, RouteTimeline). Both hit the same cleaner route/driving endpoints.
 */
import * as React from "react";
import { Navigation, ListOrdered } from "lucide-react";
import { EChip } from "@/components/v2/cleaner/fields";
import { DrivingMode } from "@/components/v2/cleaner/driving-mode";
import { RouteTimeline, type RouteStop } from "@/components/v2/cleaner/route-timeline";

export function RouteDriving({
  initialDate,
  initialStops,
  userId,
}: {
  initialDate: string;
  initialStops: RouteStop[];
  /** Cleaner id — namespaces the saved per-day stop order (localStorage). */
  userId?: string;
}) {
  const [mode, setMode] = React.useState<"drive" | "timeline">("drive");
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <EChip active={mode === "drive"} onClick={() => setMode("drive")}>
          <span className="inline-flex items-center gap-1.5">
            <Navigation className="h-3.5 w-3.5" /> Drive mode
          </span>
        </EChip>
        <EChip active={mode === "timeline"} onClick={() => setMode("timeline")}>
          <span className="inline-flex items-center gap-1.5">
            <ListOrdered className="h-3.5 w-3.5" /> Timeline
          </span>
        </EChip>
      </div>
      {mode === "drive" ? (
        <DrivingMode initialStops={initialStops} userId={userId} />
      ) : (
        <RouteTimeline initialDate={initialDate} initialStops={initialStops} userId={userId} />
      )}
    </div>
  );
}
