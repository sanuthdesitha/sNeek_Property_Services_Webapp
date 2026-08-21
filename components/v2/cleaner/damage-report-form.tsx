"use client";

/**
 * D1 — the cleaner's damage report.
 *
 * Replaces the single-damage form that used to live in job-actions.tsx. Three
 * differences that are requirements rather than polish:
 *
 * MANY ITEMS, ONE SUBMISSION. A turnover that finds a cracked screen and a
 * burnt benchtop is one visit, and each item becomes its own case so CP-7
 * raises one repair per fault. The old form forced a cleaner to submit twice
 * and gave admin no way to see they were from the same visit.
 *
 * NO COST FIELD. The old form asked the cleaner for an estimated cost. Cost is
 * an admin/QA decision on the investigation page, so it is gone from here and
 * the API strips it if sent.
 *
 * AUTOSAVE, ALWAYS. Documenting damage means standing in a property taking
 * photos on a phone that may die. Every edit debounces into a draft save, so
 * the evidence survives a dead battery or a closed tab. Saving is deliberately
 * quiet — a persistent "Saved" line, never a toast per keystroke.
 */

import * as React from "react";
import { AlertTriangle, Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { ImageAnnotator } from "@/components/shared/image-annotator";
import { EAlert, EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EConfirmButton } from "@/components/v2/admin/estate-kit";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";

/** Mirrors DamagePhotoSection. Order is the order a cleaner should shoot in. */
const PHOTO_SECTIONS = [
  { value: "OVERVIEW", label: "Overview", hint: "The whole item or wall" },
  { value: "CLOSE_UP", label: "Close-up", hint: "The damage itself" },
  { value: "CONTEXT", label: "Context", hint: "Where it sits in the room" },
  { value: "EVIDENCE", label: "Extra evidence", hint: "Serial numbers, labels, receipts" },
] as const;

const SEVERITIES = [
  { value: "MINOR", label: "Minor", hint: "Cosmetic — still usable" },
  { value: "MODERATE", label: "Moderate", hint: "Noticeable, needs repair" },
  { value: "MAJOR", label: "Major", hint: "Unusable or unsafe to use" },
  { value: "SEVERE", label: "Severe", hint: "Urgent — risk to the next guest" },
] as const;

const CAUSES = [
  { value: "GUEST", label: "Guest" },
  { value: "WEAR", label: "Wear and tear" },
  { value: "PRE_EXISTING", label: "Was already there" },
  { value: "UNKNOWN", label: "Not sure" },
] as const;

type PhotoSection = (typeof PHOTO_SECTIONS)[number]["value"];

type DamagePhoto = {
  s3Key: string;
  annotatedKey?: string | null;
  flatKey?: string | null;
  caption?: string | null;
  section: PhotoSection;
  /**
   * Display-only, never sent to the server (the schema ignores it). The
   * database stores keys, but MediaCapture renders from URLs — a reloaded
   * draft without these shows broken thumbnails, which reads as "my evidence
   * is gone".
   */
  url?: string;
  kind?: "image" | "video" | "file";
};

type DamageItem = {
  clientId: string;
  area: string;
  category: string;
  severity: (typeof SEVERITIES)[number]["value"];
  description: string;
  suspectedCause: (typeof CAUSES)[number]["value"];
  photos: DamagePhoto[];
};

type SaveState = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 1_200;

function newItem(): DamageItem {
  return {
    // Local identity only — the server replaces items wholesale on save.
    clientId: `item-${Math.random().toString(36).slice(2, 10)}`,
    area: "",
    category: "",
    severity: "MODERATE",
    description: "",
    suspectedCause: "UNKNOWN",
    photos: [],
  };
}

/** Server item -> form item. Photos arrive flat; the form groups them by section. */
function toFormItem(raw: any): DamageItem {
  return {
    clientId: raw.id ?? `item-${Math.random().toString(36).slice(2, 10)}`,
    area: raw.area ?? "",
    category: raw.category ?? "",
    severity: raw.severity ?? "MODERATE",
    description: raw.description ?? "",
    suspectedCause: raw.suspectedCause ?? "UNKNOWN",
    photos: Array.isArray(raw.photos)
      ? raw.photos.map((photo: any) => ({
          s3Key: photo.s3Key,
          annotatedKey: photo.annotatedKey ?? null,
          flatKey: photo.flatKey ?? null,
          caption: photo.caption ?? null,
          section: photo.section ?? "OVERVIEW",
          url: photo.url,
          kind: "image" as const,
        }))
      : [],
  };
}

/**
 * Same chrome convention as the other cleaner action blocks: a full card by
 * default, a bare block when `embedded` so the ActionFab sheet and the form
 * renderer can drop the body straight in.
 */
function Chrome({ embedded, children }: { embedded?: boolean; children: React.ReactNode }) {
  if (embedded) return <div className="space-y-3">{children}</div>;
  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">{children}</ECardBody>
    </ECard>
  );
}

export function DamageReportForm({
  jobId,
  address,
  onSubmitted,
  embedded,
}: {
  jobId: string;
  address?: string | null;
  onSubmitted?: () => void;
  embedded?: boolean;
}) {
  const [items, setItems] = React.useState<DamageItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [annotating, setAnnotating] = React.useState<{
    clientId: string;
    s3Key: string;
    url: string;
    caption: string;
  } | null>(null);
  const [savingMarkup, setSavingMarkup] = React.useState(false);

  // Skips the autosave that would otherwise fire immediately after hydration
  // and write the draft straight back over itself.
  const hydrated = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/cleaner/jobs/${jobId}/damage`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load the damage report.");
        if (cancelled) return;
        const loaded = Array.isArray(data.report?.items) ? data.report.items.map(toFormItem) : [];
        setItems(loaded);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          hydrated.current = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // Debounced autosave. Sends the whole list: the form owns it, and a dropped
  // partial write must never leave a draft the cleaner never saw.
  React.useEffect(() => {
    if (!hydrated.current || submitted) return;
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cleaner/jobs/${jobId}/damage`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) throw new Error("save failed");
        setSaveState("saved");
      } catch {
        // Left on screen deliberately — a cleaner needs to know the evidence is
        // not safe yet, and the next edit retries anyway.
        setSaveState("error");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [items, jobId, submitted]);

  function updateItem(clientId: string, patch: Partial<DamageItem>) {
    setItems((prev) =>
      prev.map((item) => (item.clientId === clientId ? { ...item, ...patch } : item))
    );
  }

  function setSectionPhotos(clientId: string, section: PhotoSection, media: CapturedMedia[]) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.clientId !== clientId) return item;
        const others = item.photos.filter((photo) => photo.section !== section);
        const next = media.map((m) => {
          // Keep any caption/annotation already attached to this key.
          const existing = item.photos.find((photo) => photo.s3Key === m.key);
          return {
            s3Key: m.key,
            annotatedKey: existing?.annotatedKey ?? null,
            flatKey: existing?.flatKey ?? null,
            caption: existing?.caption ?? null,
            section,
            url: m.url ?? existing?.url,
            kind: m.kind ?? existing?.kind,
          };
        });
        return { ...item, photos: [...others, ...next] };
      })
    );
  }

  function sectionMedia(item: DamageItem, section: PhotoSection): CapturedMedia[] {
    return item.photos
      .filter((photo) => photo.section === section)
      .map((photo) => ({
        key: photo.s3Key,
        url: photo.url ?? "",
        kind: photo.kind ?? "image",
      }));
  }

  /**
   * Store the uploaded overlay against its photo. The overlay is a transparent
   * PNG of the marks only — it is never displayed alone, and the server
   * flattens it onto the original at submit.
   */
  function setAnnotation(
    clientId: string,
    s3Key: string,
    annotatedKey: string,
    caption: string | null
  ) {
    setItems((prev) =>
      prev.map((item) =>
        item.clientId !== clientId
          ? item
          : {
              ...item,
              photos: item.photos.map((photo) =>
                photo.s3Key === s3Key
                  ? {
                      ...photo,
                      annotatedKey,
                      caption: caption || (photo.caption ?? null),
                      // Force a re-flatten at submit: the old composite is stale.
                      flatKey: null,
                    }
                  : photo
              ),
            }
      )
    );
  }

  /**
   * Upload the overlay PNG the annotator produced, then attach its key.
   * Same endpoint and shape the QA inspection workspace uses.
   */
  async function saveMarkup(blob: Blob, comment: string) {
    if (!annotating) return;
    setSavingMarkup(true);
    try {
      const fd = new FormData();
      fd.append("file", new File([blob], `damage-markup-${Date.now()}.png`, { type: "image/png" }));
      fd.append("folder", "damage-annotations");
      fd.append("jobId", jobId);
      const res = await fetch("/api/uploads/direct", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.key) throw new Error(data?.error || "Could not save the markup.");
      setAnnotation(annotating.clientId, annotating.s3Key, String(data.key), comment || null);
      setAnnotating(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingMarkup(false);
    }
  }

  async function submit() {
    setError(null);

    const populated = items.filter(
      (item) =>
        item.area.trim() || item.category.trim() || item.description.trim() || item.photos.length
    );
    if (populated.length === 0) {
      setError("Add at least one damaged item before submitting.");
      return;
    }
    // Checked here as well as server-side so the cleaner is told which card is
    // short before a round-trip, while still standing in front of the damage.
    const incomplete = populated.find(
      (item) =>
        !item.area.trim() ||
        !item.category.trim() ||
        item.description.trim().length < 10 ||
        item.photos.length === 0
    );
    if (incomplete) {
      setError(
        `"${incomplete.category.trim() || incomplete.area.trim() || "One item"}" needs an area, what was damaged, a description and at least one photo.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/cleaner/jobs/${jobId}/damage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: populated }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not submit the damage report.");
      setSubmitted(true);
      onSubmitted?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Chrome embedded={embedded}>
        <p className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading damage report…
        </p>
      </Chrome>
    );
  }

  if (submitted) {
    return (
      <Chrome embedded={embedded}>
        <EAlert tone="success">
          Damage report submitted. A case has been opened for each item and the admin team will
          review it. The client sees nothing until that review is done.
        </EAlert>
      </Chrome>
    );
  }

  return (
    <Chrome embedded={embedded}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
          <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-warning))]" /> Report damage
        </p>
        <SaveIndicator state={saveState} />
      </div>

      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        Add one card per damaged item. Everything is saved as you go, so you can keep working if
        your phone dies.
      </p>

      {items.map((item, index) => (
        <div
          key={item.clientId}
          className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <EBadge tone="warning">Item {index + 1}</EBadge>
            {/* Low tier: one item of a report that has not been submitted. */}
            <EConfirmButton
              ariaLabel={`Remove item ${index + 1}`}
              confirmLabel="Remove it?"
              onConfirm={() => setItems((prev) => prev.filter((i) => i.clientId !== item.clientId))}
            >
              <Trash2 className="h-4 w-4" /> Remove
            </EConfirmButton>
          </div>

          <EField label="Area / room">
            <EInput
              placeholder="e.g. Main bathroom"
              value={item.area}
              onChange={(e) => updateItem(item.clientId, { area: e.target.value })}
            />
          </EField>

          <EField label="What was damaged">
            <EInput
              placeholder="e.g. Shower screen"
              value={item.category}
              onChange={(e) => updateItem(item.clientId, { category: e.target.value })}
            />
          </EField>

          <EField label="How bad is it">
            <ESelect
              value={item.severity}
              onChange={(e) => updateItem(item.clientId, { severity: e.target.value as any })}
            >
              {SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} — {s.hint}
                </option>
              ))}
            </ESelect>
          </EField>

          <EField label="What probably caused it">
            <ESelect
              value={item.suspectedCause}
              onChange={(e) => updateItem(item.clientId, { suspectedCause: e.target.value as any })}
            >
              {CAUSES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </ESelect>
          </EField>

          <EField label="Describe the damage">
            <ETextarea
              rows={3}
              placeholder="What is damaged, how badly, and anything the next person needs to know."
              value={item.description}
              onChange={(e) => updateItem(item.clientId, { description: e.target.value })}
            />
          </EField>

          {PHOTO_SECTIONS.map((section) => {
            const shots = item.photos.filter((photo) => photo.section === section.value);
            return (
              <EField key={section.value} label={`${section.label} — ${section.hint}`}>
                <MediaCapture
                  value={sectionMedia(item, section.value)}
                  onChange={(media) => setSectionPhotos(item.clientId, section.value, media)}
                  mode="photo"
                  folder="evidence"
                  multiple
                  stamp={{
                    tag: "damage",
                    contextLabel: `Damage — ${section.label}`,
                    address: address || undefined,
                  }}
                />
                {shots.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {shots.map((photo) => (
                      <EButton
                        key={photo.s3Key}
                        variant="ghost"
                        size="sm"
                        disabled={!photo.url}
                        onClick={() =>
                          setAnnotating({
                            clientId: item.clientId,
                            s3Key: photo.s3Key,
                            url: photo.url ?? "",
                            caption: photo.caption ?? "",
                          })
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {photo.annotatedKey ? "Edit markup" : "Circle the damage"}
                      </EButton>
                    ))}
                  </div>
                ) : null}
              </EField>
            );
          })}
        </div>
      ))}

      <EButton variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, newItem()])}>
        <Plus className="h-4 w-4" /> Add {items.length === 0 ? "a damaged item" : "another item"}
      </EButton>

      {error ? <EAlert tone="danger">{error}</EAlert> : null}

      <EButton onClick={submit} disabled={submitting || items.length === 0}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Submit damage report
      </EButton>

      {annotating ? (
        <ImageAnnotator
          src={annotating.url}
          open={Boolean(annotating)}
          onOpenChange={(v) => {
            if (!v) setAnnotating(null);
          }}
          initialComment={annotating.caption}
          saving={savingMarkup}
          onSave={({ blob, comment }) => saveMarkup(blob, comment)}
        />
      ) : null}
    </Chrome>
  );
}

/** Quiet, persistent save state. Never a toast — this fires constantly. */
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        <Check className="h-3 w-3" /> Saved
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="text-[0.75rem] text-[hsl(var(--e-danger))]">
        Not saved — keep this page open
      </span>
    );
  }
  return null;
}
