"use client";

/**
 * Native Estate renderer for a lib/forms FormSchema. Renders every field type
 * from lib/forms/field-types natively (no v1 components), tracks answers +
 * uploads, applies conditional visibility via the shared lib/forms/visibility
 * helpers, and lifts state to the parent workspace.
 *
 * Answer values are stored by fieldId in `answers`; media uploads are stored by
 * fieldId in `uploads` as arrays of S3 keys — exactly the shape the submit
 * endpoint reads (`data.uploads[fieldId]`). Stock/consumables used are stored
 * under the reserved `inventoryUsage` answer key (itemId → quantity), which the
 * submit endpoint reads via `data.inventoryUsage` → `deductStockFromSubmission`.
 */
import * as React from "react";
import { usePathname } from "next/navigation";
import {
  Info,
  Star,
  MapPin,
  Loader2,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Camera,
  Package,
  AlertTriangle,
} from "lucide-react";
import type { FormField, FormSchema, FormSection } from "@/lib/forms/types";
import {
  flattenFieldsOneLevel,
  isTemplateNodeVisible,
  isFlattenedFieldVisible,
  fieldDetailsKey,
} from "@/lib/forms/visibility";
import { collectFormErrors, type FormFieldError } from "@/lib/forms/validate-submission";
import { isUploadFieldType } from "@/lib/forms/field-types";
import {
  NO_PHOTO_REASONS,
  type NoPhotoReasonCode,
  type NoPhotoReasonEntry,
} from "@/lib/forms/no-photo-reasons";
import { stripHtmlToText } from "@/lib/forms/sanitize";
import type { StampOptions } from "@/lib/uploads/stamp";
import { cn } from "@/lib/utils";
import { EInput, ETextarea, ESelect, ECheckbox } from "@/components/v2/cleaner/fields";
import { EButton } from "@/components/v2/ui/primitives";
import {
  MediaCapture,
  MediaLightbox,
  type CapturedMedia,
  type LightboxItem,
} from "@/components/v2/cleaner/media-capture";
import { GuidedCapture, type GuidedCaptureTarget } from "@/components/v2/cleaner/guided-capture";
import { ExtraPayRequest } from "@/components/v2/cleaner/job-actions";
import { DamageReportForm } from "@/components/v2/cleaner/damage-report-form";
import { ReportMaintenance } from "@/components/v2/cleaner/report-maintenance";

export type AnswerMap = Record<string, unknown>;
export type UploadMap = Record<string, CapturedMedia[]>;

export interface PropertyStockRow {
  onHand?: number;
  item: {
    id: string;
    name: string;
    sku?: string | null;
    category?: string | null;
    location?: string | null;
    unit?: string | null;
  };
}

/* ── Validation context (errors + reveal + scroll anchors) ──────────────────── */

type ValidationCtx = {
  errorFor: (fieldId: string) => string | undefined;
  isRevealed: (fieldId: string) => boolean;
  registerAnchor: (fieldId: string, el: HTMLElement | null) => void;
};

const ValidationContext = React.createContext<ValidationCtx>({
  errorFor: () => undefined,
  isRevealed: () => false,
  registerAnchor: () => {},
});

/** Whether THIS cleaner may use the "no photo taken" option (admin-granted). */
const NoPhotoContext = React.createContext<boolean>(false);

export function FormRenderer({
  schema,
  answers,
  uploads,
  property,
  inventoryStock,
  onAnswer,
  onUpload,
  disabled = false,
  collapsibleSections = false,
  sectionProgress,
  jobId,
  restockNeeds,
  onExtrasChanged,
  requiredChecklistTicksBlockSubmit = false,
  canUseNoPhoto = false,
}: {
  schema: FormSchema;
  answers: AnswerMap;
  uploads: UploadMap;
  property: Record<string, unknown>;
  /** Property stock items (from GET /api/jobs/[id]/form). Self-fetched when omitted. */
  inventoryStock?: PropertyStockRow[];
  onAnswer: (fieldId: string, value: unknown) => void;
  onUpload: (fieldId: string, media: CapturedMedia[]) => void;
  disabled?: boolean;
  /**
   * Opt-in "room accordion" mode: every section becomes collapsible, collapsed
   * by default except the first incomplete one. Default false → unchanged
   * behaviour (each section honours its own `section.collapsible`, open).
   */
  collapsibleSections?: boolean;
  /** Optional per-section "done/total" tally shown in the section header. */
  sectionProgress?: (sectionId: string) => { done: number; total: number } | undefined;
  /**
   * Job id for the "Extras" region (damage / extra pay / maintenance). When
   * omitted those three chips are hidden — the region degrades to Stock only,
   * so callers that don't wire it up are unaffected.
   */
  jobId?: string;
  /**
   * Property restock shortfalls from GET /api/jobs/[id]/form. When non-empty the
   * Stock extra auto-expands (the cleaner has something to record).
   */
  restockNeeds?: Array<{ name: string; needed: number; unit?: string | null }>;
  /** Fired after an extra is submitted, so the parent can refresh job meta. */
  onExtrasChanged?: () => void;
  /**
   * `settings.accountability.requiredChecklistTicksBlockSubmit` from the form
   * payload. Default false = historic behaviour (an unticked required checkbox
   * shows no inline error). Passed straight to collectFormErrors so this inline
   * validation matches the wrap-up gate and the submit route exactly.
   */
  requiredChecklistTicksBlockSubmit?: boolean;
  /**
   * Admin-granted "no photo taken" exemption for THIS cleaner (from the form
   * payload). Shows the option on photo fields; the submit route re-checks it.
   */
  canUseNoPhoto?: boolean;
}) {
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];

  // In accordion mode, open only the first section that still has incomplete
  // required items (falls back to the first section when all are complete).
  const firstIncompleteSectionId = React.useMemo(() => {
    if (!collapsibleSections || !sectionProgress) return null;
    for (const section of sections) {
      const p = sectionProgress(section.id);
      if (p && p.done < p.total) return section.id;
    }
    return sections[0]?.id ?? null;
  }, [collapsibleSections, sectionProgress, sections]);

  // Track which fields the cleaner has touched so inline errors don't scream
  // before they've had a chance to fill anything in.
  const [touched, setTouched] = React.useState<Set<string>>(() => new Set());
  const [revealAll, setRevealAll] = React.useState(false);

  const markTouched = React.useCallback((fieldId: string) => {
    setTouched((prev) => {
      if (prev.has(fieldId)) return prev;
      const next = new Set(prev);
      next.add(fieldId);
      return next;
    });
  }, []);

  const handleAnswer = React.useCallback(
    (fieldId: string, value: unknown) => {
      markTouched(fieldId);
      onAnswer(fieldId, value);
    },
    [markTouched, onAnswer]
  );

  const handleUpload = React.useCallback(
    (fieldId: string, media: CapturedMedia[]) => {
      markTouched(fieldId);
      onUpload(fieldId, media);
    },
    [markTouched, onUpload]
  );

  // Live validation — mirrors the submit endpoint's required-field rules.
  const uploadCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [fieldId, media] of Object.entries(uploads)) counts[fieldId] = media?.length ?? 0;
    return counts;
  }, [uploads]);

  const errors = React.useMemo<FormFieldError[]>(
    () =>
      collectFormErrors(
        schema,
        answers,
        uploadCounts,
        property,
        undefined,
        requiredChecklistTicksBlockSubmit,
        {
          canUseNoPhoto,
          reasons:
            ((answers as Record<string, unknown>).__noPhotoReasons as Record<
              string,
              { reasonCode: string }
            >) ?? {},
        }
      ),
    [schema, answers, uploadCounts, property, requiredChecklistTicksBlockSubmit, canUseNoPhoto]
  );
  const errorMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const err of errors) map.set(err.fieldId, err.message);
    return map;
  }, [errors]);

  // Scroll anchors so the summary banner (and an external "validate" signal) can
  // jump to the first offending field.
  const anchorsRef = React.useRef<Map<string, HTMLElement>>(new Map());
  const registerAnchor = React.useCallback((fieldId: string, el: HTMLElement | null) => {
    if (el) anchorsRef.current.set(fieldId, el);
    else anchorsRef.current.delete(fieldId);
  }, []);

  const scrollToField = React.useCallback((fieldId: string) => {
    const el = anchorsRef.current.get(fieldId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus?.();
    }
  }, []);

  // External integration point: any submit flow can dispatch
  // `window.dispatchEvent(new CustomEvent("sneek:validate-form"))` to force every
  // error visible and jump to the first one. Live validation works without it.
  React.useEffect(() => {
    const onValidate = () => {
      setRevealAll(true);
      const first = errors[0];
      if (first) requestAnimationFrame(() => scrollToField(first.fieldId));
    };
    window.addEventListener("sneek:validate-form", onValidate as EventListener);
    return () => window.removeEventListener("sneek:validate-form", onValidate as EventListener);
  }, [errors, scrollToField]);

  // External integration point: `sneek:focus-field` { detail: { match } } scrolls
  // to and focuses the first field whose id contains `match` (case-insensitive).
  // Used by the Clean stage's "Report an exception" shortcut to jump to the
  // exceptions field. No-op when nothing matches.
  React.useEffect(() => {
    const onFocusField = (e: Event) => {
      const match = String((e as CustomEvent)?.detail?.match ?? "").toLowerCase();
      if (!match) return;
      const id = Array.from(anchorsRef.current.keys()).find((k) => k.toLowerCase().includes(match));
      if (id) {
        setRevealAll(true);
        requestAnimationFrame(() => scrollToField(id));
      }
    };
    window.addEventListener("sneek:focus-field", onFocusField as EventListener);
    return () => window.removeEventListener("sneek:focus-field", onFocusField as EventListener);
  }, [scrollToField]);

  const validation = React.useMemo<ValidationCtx>(
    () => ({
      errorFor: (fieldId: string) => errorMap.get(fieldId),
      isRevealed: (fieldId: string) => revealAll || touched.has(fieldId),
      registerAnchor,
    }),
    [errorMap, revealAll, touched, registerAnchor]
  );

  // Show the summary once errors exist AND the cleaner has engaged (revealed all,
  // or touched at least one field) — avoids a scary banner on a pristine form.
  const visibleErrors = revealAll
    ? errors
    : errors.filter((e) => touched.has(e.fieldId));

  return (
    <NoPhotoContext.Provider value={canUseNoPhoto}>
    <ValidationContext.Provider value={validation}>
      <div className="space-y-5">
        {visibleErrors.length > 0 ? (
          <ValidationSummary errors={visibleErrors} onJump={scrollToField} />
        ) : null}

        {sections.map((section) => (
          <SectionBlock
            key={section.id}
            section={section}
            answers={answers}
            uploads={uploads}
            property={property}
            onAnswer={handleAnswer}
            onUpload={handleUpload}
            disabled={disabled}
            forceCollapsible={collapsibleSections}
            defaultOpen={collapsibleSections ? section.id === firstIncompleteSectionId : true}
            progress={sectionProgress?.(section.id)}
          />
        ))}

        <ExtrasRegion
          jobId={jobId}
          property={property}
          inventoryStock={inventoryStock}
          restockNeeds={restockNeeds}
          answers={answers}
          onAnswer={handleAnswer}
          onChanged={onExtrasChanged}
          disabled={disabled}
        />
      </div>
    </ValidationContext.Provider>
    </NoPhotoContext.Provider>
  );
}

/* ── Extras (collapsed conditional sections) ────────────────────────────────── */

/**
 * The optional, exception-path parts of a clean — damage, extra pay,
 * maintenance and stock usage — collapsed behind "Add:" chips so they never
 * pad out the checklist for the (common) job where none apply. Each chip
 * expands the SAME embedded component used elsewhere in the cleaner app; the
 * blocks reuse the section chrome/collapse behaviour of SectionBlock.
 *
 * `jobId` is optional: without it the three job-scoped extras are hidden and
 * only Stock renders, so a caller that hasn't wired the extras up yet is
 * unaffected.
 */
function ExtrasRegion({
  jobId,
  property,
  inventoryStock,
  restockNeeds,
  answers,
  onAnswer,
  onChanged,
  disabled,
}: {
  jobId?: string;
  property: Record<string, unknown>;
  inventoryStock?: PropertyStockRow[];
  restockNeeds?: Array<{ name: string; needed: number; unit?: string | null }>;
  answers: AnswerMap;
  onAnswer: (fieldId: string, value: unknown) => void;
  onChanged?: () => void;
  disabled: boolean;
}) {
  // Stock opens itself when the property is short on something.
  const stockNeeded = Array.isArray(restockNeeds) && restockNeeds.length > 0;
  const [open, setOpen] = React.useState<Record<string, boolean>>(() => ({
    stock: stockNeeded,
  }));
  const toggle = (key: string) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const stockVisible = property?.inventoryEnabled === true;
  const chips: Array<{ key: string; label: string }> = [
    ...(jobId
      ? [
          { key: "damage", label: "Damage" },
          { key: "extra-pay", label: "Extra pay" },
          { key: "maintenance", label: "Maintenance" },
        ]
      : []),
    ...(stockVisible ? [{ key: "stock", label: "Stock" }] : []),
  ];
  if (chips.length === 0) return null;

  return (
    <section className="rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <p className="e-eyebrow">Extras</p>
      <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        Only open these if something applies to this clean.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Add:</span>
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => toggle(chip.key)}
            aria-expanded={Boolean(open[chip.key])}
            className={cn(
              "rounded-[var(--e-radius-pill)] border px-3 py-1 text-[0.8125rem] font-[550] transition-colors",
              open[chip.key]
                ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-foreground))]"
                : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))] hover:border-[hsl(var(--e-gold)/0.5)]"
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {jobId && open.damage ? (
        <ExtraBlock title="Damage report">
          <DamageReportForm jobId={jobId} onSubmitted={onChanged} embedded />
        </ExtraBlock>
      ) : null}
      {jobId && open["extra-pay"] ? (
        <ExtraBlock title="Extra pay request">
          <ExtraPayRequest jobId={jobId} onChanged={onChanged} embedded />
        </ExtraBlock>
      ) : null}
      {jobId && open.maintenance ? (
        <ExtraBlock title="Report maintenance">
          <ReportMaintenance jobId={jobId} onChanged={onChanged} />
        </ExtraBlock>
      ) : null}
      {stockVisible && open.stock ? (
        <div className="mt-3">
          <StockUsageSection
            property={property}
            inventoryStock={inventoryStock}
            answers={answers}
            onAnswer={onAnswer}
            disabled={disabled}
          />
        </div>
      ) : null}
    </section>
  );
}

function ExtraBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-4">
      <p className="e-eyebrow mb-2">{title}</p>
      {children}
    </div>
  );
}

/* ── Validation summary banner ──────────────────────────────────────────────── */

function ValidationSummary({
  errors,
  onJump,
}: {
  errors: FormFieldError[];
  onJump: (fieldId: string) => void;
}) {
  return (
    <div className="rounded-[var(--e-radius-lg)] border-l-[3px] border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] p-4">
      <p className="flex items-center gap-1.5 text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">
        <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-danger))]" />
        {errors.length} required item{errors.length === 1 ? "" : "s"} incomplete
      </p>
      <ul className="mt-2 space-y-1">
        {errors.map((err) => (
          <li key={err.fieldId}>
            <button
              type="button"
              onClick={() => onJump(err.fieldId)}
              className="text-left text-[0.8125rem] text-[hsl(var(--e-danger))] underline-offset-2 hover:underline"
            >
              {err.sectionLabel && err.sectionLabel !== err.label
                ? `${stripHtmlToText(err.sectionLabel)}: ${stripHtmlToText(err.label)}`
                : stripHtmlToText(err.label)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Section ────────────────────────────────────────────────────────────────── */

function SectionBlock({
  section,
  answers,
  uploads,
  property,
  onAnswer,
  onUpload,
  disabled,
  forceCollapsible = false,
  defaultOpen = true,
  progress,
}: {
  section: FormSection;
  answers: AnswerMap;
  uploads: UploadMap;
  property: Record<string, unknown>;
  onAnswer: (fieldId: string, value: unknown) => void;
  onUpload: (fieldId: string, media: CapturedMedia[]) => void;
  disabled: boolean;
  /** Accordion mode — makes this section collapsible regardless of schema flag. */
  forceCollapsible?: boolean;
  /** Initial open state in accordion mode. */
  defaultOpen?: boolean;
  /** Optional "done/total" tally for the header badge. */
  progress?: { done: number; total: number };
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [guided, setGuided] = React.useState(false);
  const collapsible = forceCollapsible || Boolean(section.collapsible);
  const complete = progress != null && progress.total > 0 && progress.done >= progress.total;
  if (!isTemplateNodeVisible(section as any, answers, property)) return null;

  const fields = flattenFieldsOneLevel(section.fields);

  // Select-all / Clear affordance for sections made of checkbox tasks: toggles
  // every visible checkbox field in this section at once.
  const checkboxFields = fields.filter(
    (field: any) => field?.type === "checkbox" && isFlattenedFieldVisible(field, answers, property)
  );
  const allChecked =
    checkboxFields.length > 0 && checkboxFields.every((field: any) => answers[field.id] === true);
  const toggleAll = () => {
    const next = !allChecked;
    for (const field of checkboxFields) onAnswer(field.id, next);
  };

  // Photo capture targets for the guided flow: visible photo / photo+video
  // upload fields in this section.
  const photoTargets = fields.filter(
    (field: any) =>
      isFlattenedFieldVisible(field, answers, property) &&
      isUploadFieldType(field?.type) &&
      (field?.type === "photo" || field?.mediaMode === "both")
  );

  const guidedTargets: GuidedCaptureTarget[] = photoTargets.map((field: any) => ({
    fieldId: String(field.id),
    label: typeof field.label === "string" && field.label.trim() ? field.label.trim() : String(field.id),
    minPhotos: field.type === "photo" ? field.minPhotos : undefined,
    maxFiles: field.maxFiles,
  }));

  return (
    <section className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <button
        type="button"
        onClick={() => collapsible && setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <div className="min-w-0">
          <p className="e-eyebrow">{stripHtmlToText(section.title)}</p>
          {section.description ? (
            <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {stripHtmlToText(section.description)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {progress && progress.total > 0 ? (
            <span
              className={cn(
                "rounded-[var(--e-radius-pill)] px-2 py-0.5 text-[0.6875rem] font-[600] tabular-nums",
                complete
                  ? "bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-success))]"
                  : "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]"
              )}
            >
              {progress.done}/{progress.total}
            </span>
          ) : null}
          {collapsible ? (
            open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />
          ) : null}
        </div>
      </button>
      {open ? (
        <div className="space-y-4 border-t border-[hsl(var(--e-border))] p-4">
          {guidedTargets.length > 0 ? (
            <EButton
              type="button"
              variant="outline-gold"
              size="md"
              disabled={disabled}
              className="w-full"
              onClick={() => setGuided(true)}
            >
              <Camera className="h-4 w-4" />
              Capture / Add photos
              {guidedTargets.length > 1 ? ` (${guidedTargets.length} spots)` : ""}
            </EButton>
          ) : null}

          {checkboxFields.length > 1 ? (
            <div className="flex justify-end">
              <EButton
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={toggleAll}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {allChecked ? "Clear all" : "Select all"}
              </EButton>
            </div>
          ) : null}
          {fields.map((field: any) => (
            <FieldBlock
              key={field.id}
              field={field}
              section={section}
              answers={answers}
              uploads={uploads}
              property={property}
              onAnswer={onAnswer}
              onUpload={onUpload}
              disabled={disabled}
            />
          ))}
        </div>
      ) : null}

      {guided ? (
        <GuidedCapture
          targets={guidedTargets}
          sectionLabel={section.title}
          folder="forms"
          stampFor={(fieldId) => {
            const field = photoTargets.find((f: any) => String(f.id) === fieldId);
            return field ? stampForField(field, section, property) : null;
          }}
          counts={Object.fromEntries(
            guidedTargets.map((t) => [t.fieldId, uploads[t.fieldId]?.length ?? 0])
          )}
          thumbnails={Object.fromEntries(
            guidedTargets.map((t) => [
              t.fieldId,
              (uploads[t.fieldId] ?? []).filter((m) => m.kind === "image").map((m) => m.url),
            ])
          )}
          onCommit={(fieldId, media) => onUpload(fieldId, [...(uploads[fieldId] ?? []), ...media])}
          onClose={() => setGuided(false)}
        />
      ) : null}
    </section>
  );
}

/* ── Stock / consumables used ───────────────────────────────────────────────── */

function StockUsageSection({
  property,
  inventoryStock,
  answers,
  onAnswer,
  disabled,
}: {
  property: Record<string, unknown>;
  inventoryStock?: PropertyStockRow[];
  answers: AnswerMap;
  onAnswer: (fieldId: string, value: unknown) => void;
  disabled: boolean;
}) {
  const pathname = usePathname();
  const [fetched, setFetched] = React.useState<PropertyStockRow[] | null>(null);

  // Self-fetch the property's tracked stock when the parent didn't pass it (the
  // list rides on GET /api/jobs/[id]/form under `inventoryStock`). Only when the
  // property actually tracks inventory, so nothing runs otherwise.
  React.useEffect(() => {
    if (inventoryStock || property?.inventoryEnabled !== true) return;
    const jobId = pathname?.match(/\/jobs\/([^/?#]+)/)?.[1];
    if (!jobId) return;
    let cancelled = false;
    fetch(`/api/jobs/${jobId}/form`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.inventoryStock)) setFetched(d.inventoryStock);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inventoryStock, property, pathname]);

  const stock = inventoryStock ?? fetched ?? [];
  if (property?.inventoryEnabled !== true || stock.length === 0) return null;

  const usage = (answers.inventoryUsage as Record<string, unknown> | undefined) ?? {};
  const valueFor = (itemId: string) => {
    const raw = usage[itemId];
    const n = typeof raw === "number" ? raw : Number(raw ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const setUsage = (itemId: string, qty: number) => {
    const next = { ...(answers.inventoryUsage as Record<string, unknown> | undefined) };
    if (qty > 0) next[itemId] = qty;
    else delete next[itemId];
    onAnswer("inventoryUsage", next);
  };

  // Group by storage location for a tidy, scannable list.
  const groups = new Map<string, PropertyStockRow[]>();
  for (const row of stock) {
    const loc = (row.item?.location || row.item?.category || "General").toString();
    if (!groups.has(loc)) groups.set(loc, []);
    groups.get(loc)!.push(row);
  }

  return (
    <section className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <div className="p-4">
        <p className="e-eyebrow flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5" /> Stock &amp; consumables used
        </p>
        <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Record how many of each item you used — this is deducted from the property&apos;s on-hand
          count.
        </p>
      </div>
      <div className="space-y-4 border-t border-[hsl(var(--e-border))] p-4">
        {Array.from(groups.entries()).map(([location, rows]) => (
          <div key={location} className="space-y-2">
            <p className="text-[0.6875rem] font-[550] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">
              {location}
            </p>
            {rows.map((row) => {
              const itemId = String(row.item.id);
              const qty = valueFor(itemId);
              const onHand = Number(row.onHand ?? 0);
              return (
                <div
                  key={itemId}
                  className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">
                      {row.item.name}
                    </p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      {onHand} on hand{row.item.unit ? ` · ${row.item.unit}` : ""}
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      disabled={disabled || qty <= 0}
                      onClick={() => setUsage(itemId, Math.max(0, qty - 1))}
                      aria-label={`Less ${row.item.name}`}
                      className="flex h-9 w-9 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] disabled:opacity-50"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={qty === 0 ? "" : String(qty)}
                      disabled={disabled}
                      placeholder="0"
                      onChange={(e) => setUsage(itemId, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                      className="h-9 w-14 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-center text-[0.9375rem] font-semibold tabular-nums text-[hsl(var(--e-foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--e-ring))]"
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setUsage(itemId, qty + 1)}
                      aria-label={`More ${row.item.name}`}
                      className="flex h-9 w-9 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] disabled:opacity-50"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Stamp helpers ──────────────────────────────────────────────────────────── */

/**
 * Derive the evidence-stamp tag for a photo field — same heuristics as the v1
 * cleaner job page: explicit `stampTag` wins, then damage/before keywords in
 * the section/field labels, defaulting to "after".
 */
function deriveStampTag(field: any, section: FormSection): string {
  const explicit = typeof field?.stampTag === "string" ? field.stampTag.trim().toLowerCase() : "";
  if (explicit && explicit !== "auto") return explicit;
  const haystack = [
    (section as any)?.title,
    (section as any)?.label,
    (section as any)?.description,
    field?.label,
    field?.locationTag,
  ]
    .filter((v: unknown) => typeof v === "string")
    .join(" ")
    .toLowerCase();
  if (/\b(damage|broken|defect|fault)\b/.test(haystack)) return "damage";
  if (/\b(before|arrival|arrive|pre-?clean|pre clean|start|check-?in|on arrival)\b/.test(haystack)) {
    return "before";
  }
  return "after";
}

/** Property address + name for the stamp locator lines (same shape as v1). */
function stampLocation(property: Record<string, unknown>): { address?: string; reference?: string } {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const address = [property?.address, property?.suburb, property?.state, property?.postcode]
    .map(str)
    .filter(Boolean)
    .join(", ");
  return { address: address || undefined, reference: str(property?.name) || undefined };
}

/** Full evidence-stamp options for a field's captures (address/ref/context/tag). */
function stampForField(field: any, section: FormSection, property: Record<string, unknown>): StampOptions {
  const { address, reference } = stampLocation(property);
  const sectionLabel =
    (typeof (section as any)?.label === "string" && (section as any).label.trim()) ||
    (typeof section?.title === "string" && section.title.trim()) ||
    "";
  const fieldLabel = (typeof field?.label === "string" && field.label.trim()) || "";
  return {
    address,
    reference,
    contextLabel: [sectionLabel, fieldLabel].filter(Boolean).join(" · ") || undefined,
    tag: deriveStampTag(field, section),
  };
}

/* ── Field block ────────────────────────────────────────────────────────────── */

function FieldBlock({
  field,
  section,
  answers,
  uploads,
  property,
  onAnswer,
  onUpload,
  disabled,
}: {
  field: FormField & { _isChild?: boolean };
  section: FormSection;
  answers: AnswerMap;
  uploads: UploadMap;
  property: Record<string, unknown>;
  onAnswer: (fieldId: string, value: unknown) => void;
  onUpload: (fieldId: string, media: CapturedMedia[]) => void;
  disabled: boolean;
}) {
  const validation = React.useContext(ValidationContext);
  const anchorRef = React.useRef<HTMLDivElement | null>(null);

  const detailsKey = fieldDetailsKey(field.id);
  const fieldError = validation.errorFor(field.id);
  const detailsError = validation.errorFor(detailsKey);
  const showFieldError = Boolean(fieldError) && validation.isRevealed(field.id);
  const showDetailsError = Boolean(detailsError) && validation.isRevealed(field.id);

  React.useEffect(() => {
    validation.registerAnchor(field.id, anchorRef.current);
    return () => validation.registerAnchor(field.id, null);
  }, [field.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isFlattenedFieldVisible(field as any, answers, property)) return null;

  const value = answers[field.id];
  const set = (v: unknown) => onAnswer(field.id, v);
  const indent = (field as any)._isChild ? "border-l-2 border-[hsl(var(--e-border-strong))] pl-4" : "";

  // Read-only instruction block.
  if (field.type === "instruction") {
    return (
      <div className={cn("rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-info))] bg-[hsl(var(--e-info-soft))] p-3", indent)}>
        <p className="flex items-center gap-1.5 text-[0.875rem] font-[550]">
          <Info className="h-4 w-4" /> {stripHtmlToText(field.label)}
        </p>
        {field.helpText ? (
          <p className="mt-1 whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            {stripHtmlToText(field.helpText)}
          </p>
        ) : null}
        {Array.isArray(field.references) && field.references.length > 0 ? (
          <div className="mt-2">
            <ReferenceThumbs references={field.references} />
          </div>
        ) : null}
      </div>
    );
  }

  const label = (
    <div className="flex flex-wrap items-baseline gap-2">
      <label className="text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">
        {stripHtmlToText(field.label)}
        {field.required ? <span className="text-[hsl(var(--e-danger))]"> *</span> : null}
      </label>
      {field.severity && field.severity !== "low" ? (
        <span className="text-[0.625rem] font-[550] uppercase tracking-[0.06em] text-[hsl(var(--e-warning))]">
          {field.severity}
        </span>
      ) : null}
    </div>
  );

  const help = field.helpText ? (
    <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{stripHtmlToText(field.helpText)}</p>
  ) : null;

  const instructions = field.instructions ? (
    <details className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
      <summary className="cursor-pointer select-none">How to do this</summary>
      <p className="mt-1 whitespace-pre-wrap">{stripHtmlToText(field.instructions)}</p>
    </details>
  ) : null;

  // `showExampleOnTick === false` means "keep the examples collapsed" — the
  // builder offers that switch, so honour it instead of always showing thumbs.
  const references =
    Array.isArray(field.references) && field.references.length > 0 ? (
      field.showExampleOnTick === false ? (
        <details className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <summary className="cursor-pointer select-none">View examples ({field.references.length})</summary>
          <div className="mt-1.5">
            <ReferenceThumbs references={field.references} />
          </div>
        </details>
      ) : (
        <ReferenceThumbs references={field.references} />
      )
    ) : null;

  return (
    <div
      ref={anchorRef}
      tabIndex={-1}
      className={cn(
        "space-y-1.5 scroll-mt-24 outline-none",
        indent,
        showFieldError &&
          "rounded-[var(--e-radius)] border border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft)/0.35)] p-2.5"
      )}
    >
      {label}
      {references}
      <FieldControl
        field={field}
        section={section}
        value={value}
        set={set}
        uploads={uploads}
        onUpload={onUpload}
        disabled={disabled}
        property={property}
        error={showFieldError}
      />
      {isUploadFieldType(field.type) &&
      (field.type === "photo" || (field as { mediaMode?: string }).mediaMode === "both") ? (
        <NoPhotoOption
          fieldId={String(field.id)}
          hasUploads={(uploads[field.id]?.length ?? 0) > 0}
          answers={answers}
          onAnswer={onAnswer}
          disabled={disabled}
        />
      ) : null}
      {/* yes/no detail note when answered "No" */}
      {field.type === "yesno" && field.detailsWhenNo && (value === "no" || value === false) ? (
        <ETextarea
          placeholder="Add details (required)"
          value={String(answers[detailsKey] ?? "")}
          disabled={disabled}
          className={showDetailsError ? "border-[hsl(var(--e-danger))]" : undefined}
          onChange={(e) => onAnswer(detailsKey, e.target.value)}
        />
      ) : null}
      {showDetailsError ? (
        <p className="text-[0.75rem] font-[550] text-[hsl(var(--e-danger))]">{detailsError}</p>
      ) : null}
      {showFieldError ? (
        <p className="text-[0.75rem] font-[550] text-[hsl(var(--e-danger))]">{fieldError}</p>
      ) : null}
      {help}
      {instructions}
    </div>
  );
}

function FieldControl({
  field,
  section,
  value,
  set,
  uploads,
  onUpload,
  disabled,
  property,
  error,
}: {
  field: FormField;
  section: FormSection;
  value: unknown;
  set: (v: unknown) => void;
  uploads: UploadMap;
  onUpload: (fieldId: string, media: CapturedMedia[]) => void;
  disabled: boolean;
  property: Record<string, unknown>;
  error?: boolean;
}) {
  // Media/upload fields → native capture.
  if (isUploadFieldType(field.type)) {
    const mode =
      field.mediaMode === "both"
        ? "both"
        : field.type === "video"
          ? "video"
          : field.type === "file"
            ? "file"
            : "photo";
    // `maxFiles` is configurable in the builder but was only ever used to decide
    // single-vs-multiple; enforce it by trimming the committed list, so the cap
    // an admin sets is real instead of decorative.
    const maxFiles = Number.isFinite(Number(field.maxFiles)) ? Number(field.maxFiles) : undefined;
    return (
      <MediaCapture
        value={uploads[field.id] ?? []}
        onChange={(m) => onUpload(field.id, maxFiles && maxFiles > 0 ? m.slice(0, maxFiles) : m)}
        mode={mode as any}
        folder="forms"
        multiple={(field.maxFiles ?? 10) !== 1}
        // MediaCapture's own shortfall hint counts IMAGES, so only photo-capable
        // fields get it. A `file` field's minimum is enforced (and messaged) by
        // collectFormErrors, which counts documents too.
        minPhotos={field.type === "photo" ? field.minPhotos : undefined}
        disabled={disabled}
        error={error}
        stamp={stampForField(field, section, property)}
      />
    );
  }

  const errCls = error ? "border-[hsl(var(--e-danger))]" : undefined;

  switch (field.type) {
    case "longtext":
      return (
        <ETextarea
          placeholder={field.placeholder}
          value={String(value ?? "")}
          disabled={disabled}
          className={errCls}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "number":
    case "currency":
    case "temperature":
      return (
        <div className="flex items-center gap-2">
          {field.type === "currency" && !field.unit ? (
            <span className="text-[0.875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">$</span>
          ) : null}
          <EInput
            type="number"
            inputMode="decimal"
            min={field.min}
            max={field.max}
            step={field.step}
            placeholder={field.placeholder}
            value={value === undefined || value === null ? "" : String(value)}
            disabled={disabled}
            className={errCls}
            onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))}
          />
          {field.unit ? (
            <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{field.unit}</span>
          ) : null}
        </div>
      );

    case "date":
    case "time":
    case "datetime":
      return (
        <EInput
          type={field.type === "datetime" ? "datetime-local" : field.type}
          value={String(value ?? "")}
          disabled={disabled}
          className={errCls}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "email":
    case "phone":
      return (
        <EInput
          type={field.type === "email" ? "email" : "tel"}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          disabled={disabled}
          className={errCls}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "select":
      return <SelectControl field={field} value={value} set={set} disabled={disabled} errCls={errCls} />;

    case "radio":
      return <RadioControl field={field} value={value} set={set} disabled={disabled} />;

    case "multiselect":
      return <MultiSelectControl field={field} value={value} set={set} disabled={disabled} />;

    case "checkbox":
      return (
        <label className="inline-flex items-center gap-2 text-[0.875rem]">
          <ECheckbox checked={value === true} disabled={disabled} onChange={(e) => set(e.target.checked)} />
          {field.placeholder || "Yes"}
        </label>
      );

    case "yesno":
      // Stored as booleans (+ "na"): the same shape v1 wrote, that seed-template
      // conditions compare against (`value: true`) and that the report view
      // model reads. Writing "yes"/"no" strings here made every yes/no rule
      // dead and printed answered fields as blank in the report.
      return (
        <div className="flex flex-wrap gap-2">
          <OptionChip active={value === "yes" || value === true} disabled={disabled} onClick={() => set(true)}>
            Yes
          </OptionChip>
          <OptionChip active={value === "no" || value === false} disabled={disabled} onClick={() => set(false)}>
            No
          </OptionChip>
          {field.includeNa ? (
            <OptionChip active={value === "na"} disabled={disabled} onClick={() => set("na")}>
              N/A
            </OptionChip>
          ) : null}
        </div>
      );

    case "rating": {
      const max = field.max ?? 5;
      const current = Number(value ?? 0);
      return (
        <div className="flex gap-1">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => set(n)}
              aria-label={`${n} star`}
              className="text-[hsl(var(--e-gold))] disabled:opacity-50"
            >
              <Star className="h-6 w-6" fill={n <= current ? "currentColor" : "none"} />
            </button>
          ))}
        </div>
      );
    }

    case "slider":
    case "scale": {
      const min = field.min ?? (field.type === "scale" ? 1 : 0);
      const max = field.max ?? (field.type === "scale" ? 5 : 10);
      const step = field.step ?? 1;
      // An untouched slider must not LOOK answered: the thumb rests at min but
      // the readout stays "—" until the cleaner actually sets a value (which is
      // also why a required slider can legitimately still be flagged).
      const unset = value === undefined || value === null || value === "";
      const current = unset ? min : Number(value);
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={current}
            disabled={disabled}
            onChange={(e) => set(Number(e.target.value))}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-[hsl(var(--e-surface-sunken))]"
            style={{ accentColor: "hsl(var(--e-primary))" }}
          />
          <span className="w-12 text-right text-[0.875rem] font-[550] tabular-nums">
            {unset ? "—" : `${current}${field.unit ? ` ${field.unit}` : ""}`}
          </span>
        </div>
      );
    }

    case "counter": {
      const min = field.min ?? 0;
      const step = field.step ?? 1;
      const unset = value === undefined || value === null || value === "";
      const current = unset ? min : Number(value);
      return (
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            disabled={disabled || current <= min}
            onClick={() => set(Math.max(min, current - step))}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] disabled:opacity-50"
          >
            −
          </button>
          <span className="w-12 text-center text-[0.9375rem] font-semibold tabular-nums">
            {unset ? "—" : current}
          </span>
          <button
            type="button"
            disabled={disabled || (field.max != null && current >= field.max)}
            onClick={() => set(current + step)}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] disabled:opacity-50"
          >
            +
          </button>
        </div>
      );
    }

    case "signature":
      return <SignaturePad value={typeof value === "string" ? value : null} onChange={set} disabled={disabled} />;

    case "location":
      return <LocationCapture value={value as any} onChange={set} disabled={disabled} />;

    case "barcode":
      return (
        <EInput
          placeholder="Scan or type code"
          value={String(value ?? "")}
          disabled={disabled}
          className={errCls}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "text":
    default:
      return (
        <EInput
          placeholder={field.placeholder}
          value={String(value ?? "")}
          disabled={disabled}
          className={errCls}
          onChange={(e) => set(e.target.value)}
        />
      );
  }
}

/**
 * Reference/example media shown next to a task: small image thumbnails that open
 * a swipeable lightbox (prev/next) on tap, plus plain links for videos/URLs.
 */
/**
 * "I couldn't take a photo" — admin-granted exemption, deliberately understated
 * so it never reads as an easy way out. Recording a reason waives the field's
 * photo requirement (the server re-checks the grant); an actual upload always
 * beats the waiver, and a recorded miss deducts QA points automatically.
 */
function NoPhotoOption({
  fieldId,
  hasUploads,
  answers,
  onAnswer,
  disabled,
}: {
  fieldId: string;
  hasUploads: boolean;
  answers: Record<string, unknown>;
  onAnswer: (fieldId: string, value: unknown) => void;
  disabled: boolean;
}) {
  const canUseNoPhoto = React.useContext(NoPhotoContext);
  const [expanded, setExpanded] = React.useState(false);
  const [reasonCode, setReasonCode] = React.useState<NoPhotoReasonCode | "">("");
  const [note, setNote] = React.useState("");

  const reasonsMap =
    ((answers as Record<string, unknown>).__noPhotoReasons as
      | Record<string, NoPhotoReasonEntry>
      | undefined) ?? {};
  const entry = reasonsMap[fieldId];

  if (!canUseNoPhoto || hasUploads) return null;

  const writeMap = (next: Record<string, NoPhotoReasonEntry>) => {
    onAnswer("__noPhotoReasons", next);
  };

  if (entry) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning))] bg-[hsl(var(--e-surface-2))] px-3 py-2 text-[0.75rem]">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-warning))]" />
        <span className="min-w-0 font-[550]">
          No photo — {NO_PHOTO_REASONS[entry.reasonCode]}
          {entry.note ? ` (${entry.note})` : ""}
        </span>
        <span className="text-[hsl(var(--e-text-faint))]">QA points will be deducted.</span>
        <EButton
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            const next = { ...reasonsMap };
            delete next[fieldId];
            writeMap(next);
            setExpanded(false);
          }}
        >
          Undo
        </EButton>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setExpanded(true)}
        className="text-left text-[0.75rem] text-[hsl(var(--e-text-faint))] underline-offset-2 hover:underline disabled:opacity-50"
      >
        I couldn&apos;t take a photo…
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-2))] p-3">
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Photos are expected for every item — use this only when a photo is genuinely impossible.
        Missing photos automatically deduct points from your QA score.
      </p>
      <ESelect
        value={reasonCode}
        disabled={disabled}
        onChange={(e) => setReasonCode(e.target.value as NoPhotoReasonCode | "")}
      >
        <option value="">Why couldn&apos;t you take a photo?</option>
        {Object.entries(NO_PHOTO_REASONS).map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </ESelect>
      <ETextarea
        placeholder={reasonCode === "OTHER" ? "Explain what happened (required)" : "Add a note (optional)"}
        value={note}
        disabled={disabled}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <EButton size="sm" variant="ghost" disabled={disabled} onClick={() => setExpanded(false)}>
          Cancel
        </EButton>
        <EButton
          size="sm"
          variant="outline"
          disabled={disabled || !reasonCode || (reasonCode === "OTHER" && !note.trim())}
          onClick={() => {
            if (!reasonCode) return;
            writeMap({
              ...reasonsMap,
              [fieldId]: {
                reasonCode,
                ...(note.trim() ? { note: note.trim() } : {}),
              },
            });
            setExpanded(false);
            setReasonCode("");
            setNote("");
          }}
        >
          Record no photo
        </EButton>
      </div>
    </div>
  );
}

function ReferenceThumbs({ references }: { references: any[] }) {
  const [lightbox, setLightbox] = React.useState<number | null>(null);
  const imageRefs = references.filter((r) => r?.kind === "image" && r?.url);
  const items: LightboxItem[] = imageRefs.map((r) => ({ url: r.url, kind: "image", caption: r.caption }));

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {references.map((ref, i) => {
          if (ref?.kind === "image" && ref.url) {
            const idx = imageRefs.indexOf(ref);
            return (
              <button
                key={i}
                type="button"
                onClick={() => setLightbox(idx)}
                className="group relative h-16 w-16 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]"
                aria-label={ref.caption ? `View ${ref.caption}` : "View reference image"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ref.url}
                  alt={ref.caption || "reference"}
                  className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-105"
                />
              </button>
            );
          }
          return ref?.url ? (
            <a
              key={i}
              href={ref.url}
              target="_blank"
              rel="noreferrer"
              className="text-[0.75rem] underline"
            >
              {ref.caption || ref.kind}
            </a>
          ) : null;
        })}
      </div>
      {lightbox != null && items.length > 0 ? (
        <MediaLightbox
          items={items}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </>
  );
}

/* ── Choice controls (option lists + optional free-text "Other") ─────────────
 * `allowOther` is configurable in the builder for select / radio / multi-select,
 * so all three honour it here: the answer is stored as the plain typed string
 * (or as an extra array entry for multi-select), which is what reports and
 * conditions already read — no sentinel value ever reaches the submission.
 */
const OTHER_SENTINEL = "__other__";

function OtherTextInput({
  value,
  placeholder = "Type your answer",
  disabled,
  onChange,
  autoFocus = false,
}: {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  /** Only when the input appears in response to a tap (never on mount). */
  autoFocus?: boolean;
}) {
  return (
    <EInput
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function SelectControl({
  field,
  value,
  set,
  disabled,
  errCls,
}: {
  field: FormField;
  value: unknown;
  set: (v: unknown) => void;
  disabled: boolean;
  errCls?: string;
}) {
  const options = field.options ?? [];
  const current = String(value ?? "");
  const valueIsOther = Boolean(current) && !options.includes(current);
  const [otherOpen, setOtherOpen] = React.useState(valueIsOther);
  const showOther = Boolean(field.allowOther) && (otherOpen || valueIsOther);

  return (
    <div className="space-y-1.5">
      <ESelect
        value={showOther ? OTHER_SENTINEL : current}
        disabled={disabled}
        className={errCls}
        onChange={(e) => {
          if (e.target.value === OTHER_SENTINEL) {
            setOtherOpen(true);
            set("");
            return;
          }
          setOtherOpen(false);
          set(e.target.value);
        }}
      >
        <option value="">Select…</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
        {field.allowOther ? <option value={OTHER_SENTINEL}>Other…</option> : null}
      </ESelect>
      {showOther ? (
        <OtherTextInput autoFocus value={valueIsOther ? current : ""} disabled={disabled} onChange={set} />
      ) : null}
    </div>
  );
}

function RadioControl({
  field,
  value,
  set,
  disabled,
}: {
  field: FormField;
  value: unknown;
  set: (v: unknown) => void;
  disabled: boolean;
}) {
  const options = field.options ?? [];
  const current = String(value ?? "");
  const valueIsOther = Boolean(current) && !options.includes(current);
  const [otherOpen, setOtherOpen] = React.useState(valueIsOther);
  const showOther = Boolean(field.allowOther) && (otherOpen || valueIsOther);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <OptionChip
            key={opt}
            active={current === opt}
            disabled={disabled}
            onClick={() => {
              setOtherOpen(false);
              set(opt);
            }}
          >
            {opt}
          </OptionChip>
        ))}
        {field.allowOther ? (
          <OptionChip
            active={showOther}
            disabled={disabled}
            onClick={() => {
              setOtherOpen(true);
              if (!valueIsOther) set("");
            }}
          >
            Other…
          </OptionChip>
        ) : null}
      </div>
      {showOther ? (
        <OtherTextInput autoFocus value={valueIsOther ? current : ""} disabled={disabled} onChange={set} />
      ) : null}
    </div>
  );
}

function MultiSelectControl({
  field,
  value,
  set,
  disabled,
}: {
  field: FormField;
  value: unknown;
  set: (v: unknown) => void;
  disabled: boolean;
}) {
  const options = field.options ?? [];
  const selected = Array.isArray(value) ? (value as unknown[]).map((v) => String(v)) : [];
  const extras = selected.filter((v) => !options.includes(v));
  const [draft, setDraft] = React.useState("");

  const toggle = (opt: string) =>
    set(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <OptionChip key={opt} active={selected.includes(opt)} disabled={disabled} onClick={() => toggle(opt)}>
            {opt}
          </OptionChip>
        ))}
        {extras.map((extra) => (
          <OptionChip key={`x-${extra}`} active disabled={disabled} onClick={() => toggle(extra)}>
            {extra} ×
          </OptionChip>
        ))}
      </div>
      {field.allowOther ? (
        <div className="flex items-center gap-2">
          <OtherTextInput
            value={draft}
            placeholder="Add another…"
            disabled={disabled}
            onChange={setDraft}
          />
          <EButton
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !draft.trim() || selected.includes(draft.trim())}
            onClick={() => {
              set([...selected, draft.trim()]);
              setDraft("");
            }}
          >
            Add
          </EButton>
        </div>
      ) : null}
    </div>
  );
}

function OptionChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-[var(--e-radius-pill)] border px-3.5 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms] disabled:opacity-50",
        active
          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] hover:bg-[hsl(var(--e-muted))]"
      )}
    >
      {children}
    </button>
  );
}

function LocationCapture({
  value,
  onChange,
  disabled,
}: {
  value: { lat: number; lng: number } | null | undefined;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  function grab() {
    setErr(null);
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setBusy(false);
      },
      (e) => {
        setErr(e.message || "Could not get location");
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={grab}
        className="inline-flex h-9 items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] font-[550] hover:bg-[hsl(var(--e-muted))] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
        Capture GPS
      </button>
      {value && typeof value.lat === "number" ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] tabular-nums">
          {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
        </p>
      ) : null}
      {err ? <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{err}</p> : null}
    </div>
  );
}

function SignaturePad({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const drawing = React.useRef(false);

  // Repaint a stored signature when the pad remounts (collapsing a section or
  // reopening the job used to show an empty pad even though the answer held a
  // signature — the cleaner would then sign twice or think it was lost).
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value || !value.startsWith("data:image/")) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = value;
    // Mount-only: re-running on every stroke would fight the live drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The canvas has a fixed 480×160 backing store but is CSS-stretched to the
  // container width, so pointer coordinates (CSS px) must be scaled into canvas
  // space — without this the ink lands offset from the fingertip on any screen
  // narrower than 480px, i.e. every phone.
  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const scaleX = r.width > 0 ? c.width / r.width : 1;
    const scaleY = r.height > 0 ? c.height / r.height : 1;
    return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
  }
  function start(e: React.PointerEvent) {
    if (disabled) return;
    drawing.current = true;
    // Keep receiving moves if the finger strays outside the pad mid-stroke.
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current!.toDataURL("image/png"));
  }
  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    onChange("");
  }

  return (
    <div className="space-y-1.5">
      <canvas
        ref={canvasRef}
        width={480}
        height={160}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full max-w-md touch-none rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-white"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] underline disabled:opacity-50"
        >
          Clear
        </button>
        {value && value.startsWith("data:image/") ? (
          <span className="text-[0.75rem] text-[hsl(var(--e-success))]">Signed</span>
        ) : null}
      </div>
    </div>
  );
}
