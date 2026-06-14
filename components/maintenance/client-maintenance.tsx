"use client";

import * as React from "react";
import { Wrench, Image as ImageIcon } from "lucide-react";
import {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
} from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { ReportMaintenanceSheet } from "@/components/maintenance/report-maintenance-sheet";
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  priorityTone,
  statusTone,
} from "@/lib/maintenance/labels";

interface ClientProperty {
  id: string;
  name: string;
  suburb?: string | null;
}

interface MaintenanceListItem {
  id: string;
  propertyId: string;
  category: MaintenanceCategory;
  area: string | null;
  title: string;
  description: string | null;
  recommendedAction: keyof typeof ACTION_LABELS;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  property?: { name: string };
  photos?: Array<{ key: string; url: string }>;
}

export function ClientMaintenance({ properties }: { properties: ClientProperty[] }) {
  const [propertyId, setPropertyId] = React.useState<string>("ALL");
  const [items, setItems] = React.useState<MaintenanceListItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (propertyId !== "ALL") params.set("propertyId", propertyId);
    try {
      const res = await fetch(`/api/maintenance?${params.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      setItems(Array.isArray(body.items) ? body.items : []);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const reportProperty = propertyId !== "ALL" ? propertyId : properties[0]?.id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={propertyId} onValueChange={setPropertyId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="All properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All properties</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}{p.suburb ? ` · ${p.suburb}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {reportProperty ? (
          <ReportMaintenanceSheet
            propertyId={reportProperty}
            triggerLabel="Report an item"
            triggerVariant="default"
            onReported={load}
          />
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Wrench className="h-6 w-6" />}
          title="Nothing flagged"
          body="When our team or you flag something on your Airbnb property that needs fixing or replacing, it shows up here with live status."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="rounded-xl">
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.property?.name ?? ""}
                      {item.area ? ` · ${item.area}` : ""} · {CATEGORY_LABELS[item.category]}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant={priorityTone(item.priority)}>{PRIORITY_LABELS[item.priority]}</Badge>
                    <Badge variant={statusTone(item.status)}>{STATUS_LABELS[item.status]}</Badge>
                  </div>
                </div>
                {item.description ? (
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Recommended: {ACTION_LABELS[item.recommendedAction]}</span>
                  {item.photos && item.photos.length > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon className="h-3 w-3" /> {item.photos.length}
                    </span>
                  ) : null}
                </div>
                {item.photos && item.photos.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {item.photos.slice(0, 4).map((photo) => (
                      <a key={photo.key} href={photo.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url}
                          alt={item.title}
                          className="h-16 w-16 rounded-lg border border-border object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}
                {item.status === "RESOLVED" && item.resolutionNote ? (
                  <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                    Resolved: {item.resolutionNote}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
