import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Camera, CheckCircle2, AlertTriangle, Video as VideoIcon } from "lucide-react";
import { Role, MediaType } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { normalizeReworkAreas, REWORK_AREA_FIELD_PREFIX } from "@/lib/qa/rework-jobs";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Media = { url: string; isVideo: boolean };

async function presign(key: string): Promise<string | null> {
  try {
    return await getPresignedDownloadUrl(key);
  } catch {
    return null;
  }
}

function MediaTile({ m, label }: { m: Media; label: string }) {
  return (
    <a
      href={m.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block aspect-square overflow-hidden rounded-lg border border-border bg-surface-raised"
      title={label}
    >
      {m.isVideo ? (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={m.url} className="h-full w-full object-cover" muted preload="metadata" />
          <span className="absolute inset-0 flex items-center justify-center">
            <VideoIcon className="h-6 w-6 text-white drop-shadow" />
          </span>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.url} alt={label} className="h-full w-full object-cover transition group-hover:scale-105" />
      )}
    </a>
  );
}

export default async function RecleanReviewPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);

  const job = await db.job.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      jobNumber: true,
      isRework: true,
      reworkReason: true,
      reworkAreas: true,
      reworkOfJobId: true,
      property: { select: { name: true, suburb: true } },
      formSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          createdAt: true,
          submittedBy: { select: { name: true, email: true } },
          media: { select: { fieldId: true, s3Key: true, mediaType: true } },
        },
      },
    },
  });

  if (!job) notFound();
  if (!job.isRework) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/jobs/${job.id}`}><ArrowLeft className="mr-2 h-4 w-4" />Back to job</Link>
        </Button>
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          This job is not a reclean, so there is no before/after to compare.
        </div>
      </div>
    );
  }

  const areas = normalizeReworkAreas(job.reworkAreas);
  const submission = job.formSubmissions[0] ?? null;

  // Group the cleaner's "after" media by the flagged-area field id.
  const afterByArea = new Map<string, Media[]>();
  if (submission) {
    for (const m of submission.media) {
      if (!m.fieldId.startsWith(REWORK_AREA_FIELD_PREFIX)) continue;
      const areaId = m.fieldId.slice(REWORK_AREA_FIELD_PREFIX.length);
      const url = await presign(m.s3Key);
      if (!url) continue;
      const list = afterByArea.get(areaId) ?? [];
      list.push({ url, isVideo: m.mediaType === MediaType.VIDEO });
      afterByArea.set(areaId, list);
    }
  }

  // Presign the "before" QA guidance images per area.
  const beforeByArea = new Map<string, Media[]>();
  for (const area of areas) {
    const media: Media[] = [];
    for (const key of area.photoKeys) {
      const url = await presign(key);
      if (url) media.push({ url, isVideo: /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(key) });
    }
    beforeByArea.set(area.id, media);
  }

  const reviewedAreas = areas.filter((a) => (afterByArea.get(a.id)?.length ?? 0) > 0).length;

  return (
    <div className="space-y-6">
      <Button asChild variant="outline" size="sm">
        <Link href={`/admin/jobs/${job.id}`}><ArrowLeft className="mr-2 h-4 w-4" />Back to job</Link>
      </Button>

      <PageHeader
        icon={<CheckCircle2 />}
        title="Reclean — before / after"
        description={`${job.property.name} · ${job.property.suburb} · Job #${job.jobNumber}`}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{areas.length} flagged area(s)</Badge>
        <Badge variant={reviewedAreas === areas.length ? "default" : "outline"}>
          {reviewedAreas}/{areas.length} re-done with after media
        </Badge>
        {submission ? (
          <span className="text-xs text-muted-foreground">
            Resubmitted {new Date(submission.createdAt).toLocaleString("en-AU")} by{" "}
            {submission.submittedBy?.name || submission.submittedBy?.email || "cleaner"}
          </span>
        ) : (
          <span className="text-xs text-amber-600">No reclean submission yet.</span>
        )}
      </div>

      {job.reworkReason ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><span className="font-medium">Why it was sent back:</span> {job.reworkReason}</p>
        </div>
      ) : null}

      {areas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No flagged areas were recorded for this reclean.
        </div>
      ) : (
        <div className="space-y-5">
          {areas.map((area, i) => {
            const before = beforeByArea.get(area.id) ?? [];
            const after = afterByArea.get(area.id) ?? [];
            return (
              <Card key={area.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    {area.label}
                  </CardTitle>
                  {area.note ? <p className="text-sm text-muted-foreground">{area.note}</p> : null}
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* BEFORE — QA flagged + annotated */}
                    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5" /> Before — QA flagged
                      </p>
                      {before.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2">
                          {before.map((m, j) => <MediaTile key={j} m={m} label={`Before — ${area.label}`} />)}
                        </div>
                      ) : (
                        <p className="flex items-center gap-1.5 py-4 text-xs text-muted-foreground"><Camera className="h-4 w-4" />No QA photo.</p>
                      )}
                    </div>

                    {/* AFTER — cleaner's reclean */}
                    <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                        <CheckCircle2 className="h-3.5 w-3.5" /> After — cleaner re-did
                      </p>
                      {after.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2">
                          {after.map((m, j) => <MediaTile key={j} m={m} label={`After — ${area.label}`} />)}
                        </div>
                      ) : (
                        <p className="flex items-center gap-1.5 py-4 text-xs text-amber-600"><AlertTriangle className="h-4 w-4" />Not re-done yet.</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
