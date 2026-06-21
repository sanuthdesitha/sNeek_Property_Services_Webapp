"use client";

import * as React from "react";
import Link from "next/link";
import { MapPin, Calendar, ImageOff, Wrench, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";

type Photo = { key: string; url: string };

interface JobItem {
  id: string;
  title: string;
  category: string | null;
  priority: string | null;
  status: string | null;
  area: string | null;
  scheduledFor: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  outcome: string | null;
  photos: Photo[];
  property: {
    name: string | null;
    address: string | null;
    suburb: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
}

interface MineResponse {
  worker: { id: string; name: string | null; onboardedAt: string | null } | null;
  items: JobItem[];
}

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "warning" | "success" | "outline"> = {
  URGENT: "destructive",
  HIGH: "warning",
  MEDIUM: "secondary",
  LOW: "outline",
};

function priorityVariant(p: string | null) {
  return (p && PRIORITY_VARIANT[p]) || "secondary";
}

function statusVariant(s: string | null): "default" | "secondary" | "destructive" | "warning" | "success" | "outline" {
  switch (s) {
    case "IN_PROGRESS":
      return "warning";
    case "RESOLVED":
      return "success";
    case "DISMISSED":
      return "outline";
    default:
      return "secondary";
  }
}

function prettyEnum(v: string | null): string {
  if (!v) return "";
  return v
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Derive a friendly visit stage from the lifecycle timestamps. */
function visitStage(item: JobItem): { label: string; tone: "muted" | "active" | "done" } {
  if (item.clockOutAt || item.outcome) return { label: "Done", tone: "done" };
  if (item.clockInAt) return { label: "On site", tone: "active" };
  if (item.arrivedAt) return { label: "Arrived", tone: "active" };
  if (item.enRouteAt) return { label: "En route", tone: "active" };
  return { label: "Scheduled", tone: "muted" };
}

function formatSchedule(iso: string | null): string {
  if (!iso) return "Not scheduled";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not scheduled";
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function WorkerJobsList({ scope = "active" }: { scope?: "active" | "history" }) {
  const [items, setItems] = React.useState<JobItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/maintenance/mine?scope=${scope}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Could not load your jobs.");
        }
        const data: MineResponse = await res.json();
        if (!cancelled) setItems(data.items ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your jobs.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const isHistory = scope === "history";

  return (
    <div className="space-y-5">
      <PageHeader
        title={isHistory ? "History" : "My Jobs"}
        description={isHistory ? "Repairs you've completed." : "Your assigned repair jobs."}
        icon={<Wrench />}
      />

      {error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : items === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="flex gap-3 py-4">
                <div className="h-16 w-16 shrink-0 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Wrench className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {isHistory ? "No completed jobs yet." : "No jobs assigned to you."}
            </p>
            <p className="text-xs text-muted-foreground">
              {isHistory
                ? "Jobs you finish will show up here."
                : "New repair jobs will appear here when they're assigned to you."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const stage = visitStage(item);
            const thumb = item.photos?.[0]?.url ?? null;
            return (
              <Link key={item.id} href={`/maintenance/visits/${item.id}`} className="block">
                <Card className="transition-colors hover:border-primary/50 active:bg-muted/40">
                  <CardContent className="flex items-stretch gap-3 py-4">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageOff className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>

                      {item.property ? (
                        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {[item.property.name, item.property.suburb].filter(Boolean).join(" · ") ||
                              item.property.address ||
                              "Property"}
                          </span>
                        </p>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.priority ? (
                          <Badge variant={priorityVariant(item.priority)}>{prettyEnum(item.priority)}</Badge>
                        ) : null}
                        {item.status ? (
                          <Badge variant={statusVariant(item.status)}>{prettyEnum(item.status)}</Badge>
                        ) : null}
                        <Badge variant={stage.tone === "done" ? "success" : stage.tone === "active" ? "warning" : "outline"}>
                          {stage.label}
                        </Badge>
                      </div>

                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Calendar className="h-3 w-3 shrink-0" />
                        {formatSchedule(item.scheduledFor)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default WorkerJobsList;
