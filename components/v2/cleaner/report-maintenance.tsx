"use client";

/**
 * Native Estate "Report maintenance" action — parity with the v1
 * `ReportMaintenanceSheet`. Posts the SAME payload to the SAME endpoint
 * (`POST /api/maintenance`) so admin/QA/client maintenance tracking is fed
 * identically from the Estate cleaner workspace.
 *
 * JobActions only hands us a `jobId`, but /api/maintenance requires a
 * `propertyId` (server enforces Airbnb-only gating). We resolve the propertyId,
 * jobType and full address from the SAME lightweight endpoint the workspace
 * already loads — `GET /api/jobs/[id]/form` (returns the full `job` incl.
 * `propertyId`, `jobType`, `property`). Maintenance is only meaningful for
 * Airbnb turnovers (matching v1, which only renders the trigger then), so the
 * card hides itself for non-Airbnb jobs.
 *
 * Estate primitives / MediaCapture only — zero dependency on the v1 UI tree.
 */
import * as React from "react";
import { Wrench, Loader2 } from "lucide-react";
import {
  MaintenanceAction,
  MaintenanceCategory,
  MaintenancePriority,
} from "@prisma/client";
import { EBadge, EButton, ECard, ECardBody, EAlert } from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
} from "@/lib/maintenance/labels";
import { toast } from "@/hooks/use-toast";

const CATEGORIES = Object.values(MaintenanceCategory);
const ACTIONS = Object.values(MaintenanceAction);
const PRIORITIES = Object.values(MaintenancePriority);

type JobMeta = {
  propertyId: string;
  isAirbnb: boolean;
  address: string;
};

async function resolveJobMeta(jobId: string): Promise<JobMeta | null> {
  try {
    const res = await fetch(`/api/jobs/${jobId}/form`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const job = data?.job;
    if (!job?.propertyId) return null;
    const p = job.property ?? {};
    const address = [p.address, p.suburb, p.state, p.postcode].filter(Boolean).join(", ");
    return {
      propertyId: String(job.propertyId),
      isAirbnb: String(job.jobType ?? "") === "AIRBNB_TURNOVER",
      address,
    };
  } catch {
    return null;
  }
}

export function ReportMaintenance({
  jobId,
  onChanged,
}: {
  jobId: string;
  onChanged?: () => void;
}) {
  const [meta, setMeta] = React.useState<JobMeta | null>(null);
  const [ready, setReady] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [category, setCategory] = React.useState<MaintenanceCategory>("OTHER");
  const [area, setArea] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [recommendedAction, setRecommendedAction] = React.useState<MaintenanceAction>("REPLACE");
  const [priority, setPriority] = React.useState<MaintenancePriority>("MEDIUM");
  const [photos, setPhotos] = React.useState<CapturedMedia[]>([]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const resolved = await resolveJobMeta(jobId);
      if (alive) {
        setMeta(resolved);
        setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobId]);

  function reset() {
    setCategory("OTHER");
    setArea("");
    setTitle("");
    setDescription("");
    setRecommendedAction("REPLACE");
    setPriority("MEDIUM");
    setPhotos([]);
    setError(null);
  }

  async function submit() {
    setError(null);
    if (!title.trim()) {
      setError("Add a short title — describe the item in a few words.");
      return;
    }
    if (!meta?.propertyId) {
      setError("Could not resolve this job's property. Please retry.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: meta.propertyId,
          jobId: jobId ?? undefined,
          category,
          area: area.trim() || undefined,
          title: title.trim(),
          description: description.trim() || undefined,
          recommendedAction,
          priority,
          photoKeys: photos.length > 0 ? photos.map((p) => p.key) : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not submit. Please retry.");
        return;
      }
      toast({ title: "Reported", description: "Added to the maintenance tracker." });
      reset();
      setOpen(false);
      onChanged?.();
    } catch {
      setError("Network error. Please retry.");
    } finally {
      setSubmitting(false);
    }
  }

  // Maintenance tracking is Airbnb-only (server-gated + v1 parity). Hide the
  // card entirely until we know it applies to this job.
  if (!ready || !meta?.isAirbnb) return null;

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
          <Wrench className="h-4 w-4" /> Report maintenance
        </p>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Old, worn, broken, or outdated items that hurt the guest experience — tracked to resolution.
        </p>
        <EButton variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Wrench className="h-4 w-4" /> Report something to fix / replace
        </EButton>
      </ECardBody>

      <EModal
        open={open}
        onClose={() => (submitting ? undefined : setOpen(false))}
        eyebrow="Maintenance"
        title="Report something to fix or replace"
      >
        <div className="space-y-4">
          <EField label="What needs attention?">
            <EInput
              value={title}
              maxLength={180}
              placeholder="e.g. Cracked bedside lamp"
              onChange={(e) => setTitle(e.target.value)}
            />
          </EField>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EField label="Category">
              <ESelect value={category} onChange={(e) => setCategory(e.target.value as MaintenanceCategory)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Area / room (optional)">
              <EInput
                value={area}
                maxLength={120}
                placeholder="e.g. Master bedroom"
                onChange={(e) => setArea(e.target.value)}
              />
            </EField>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EField label="Recommended action">
              <ESelect
                value={recommendedAction}
                onChange={(e) => setRecommendedAction(e.target.value as MaintenanceAction)}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a]}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Priority">
              <ESelect value={priority} onChange={(e) => setPriority(e.target.value as MaintenancePriority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </ESelect>
            </EField>
          </div>

          <EField label="Details (optional)">
            <ETextarea
              value={description}
              rows={4}
              maxLength={6000}
              placeholder="What's wrong, how bad, anything the team should know."
              onChange={(e) => setDescription(e.target.value)}
            />
          </EField>

          <EField label="Photos (optional)">
            <MediaCapture
              value={photos}
              onChange={setPhotos}
              mode="photo"
              folder="uploads"
              multiple
              stamp={{ tag: "damage", contextLabel: "Maintenance report", address: meta.address || undefined }}
            />
          </EField>

          {error ? <EAlert tone="danger">{error}</EAlert> : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            <EBadge tone="neutral" soft>
              Routed to admin
            </EBadge>
            <div className="flex gap-2">
              <EButton variant="ghost" size="sm" disabled={submitting} onClick={() => setOpen(false)}>
                Cancel
              </EButton>
              <EButton variant="gold" size="sm" disabled={submitting} onClick={submit}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                Submit report
              </EButton>
            </div>
          </div>
        </div>
      </EModal>
    </ECard>
  );
}
