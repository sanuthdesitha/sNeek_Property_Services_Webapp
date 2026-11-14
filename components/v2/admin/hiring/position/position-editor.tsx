"use client";

import { useRestorableState } from "@/hooks/use-restorable-state";

/**
 * ESTATE-native hiring position editor — a self-contained re-imagining of the
 * classic components/hiring/position-editor. Posts to the SAME workforce
 * endpoints:
 *   POST   /api/admin/workforce/hiring/positions                (create)
 *   PATCH  /api/admin/workforce/hiring/positions/[id]           (details)
 *   PATCH  /api/admin/workforce/hiring/positions/[id]/application-schema
 *   PATCH  /api/admin/workforce/hiring/positions/[id]/screening-schema
 *   POST   /api/admin/workforce/hiring/positions/[id]/save-as-quiz
 * and stores the identical data shapes (application steps/fields, screening
 * questions). Built purely on the Estate kit — zero imports from
 * components/{ui,shared,admin,hiring,forms}. Upload dropzone (classic-only) is
 * intentionally omitted; hero image is set via URL.
 */
import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, ClipboardList, ListChecks, GraduationCap, Users } from "lucide-react";
import { EButton, EPageHeader, EBadge } from "@/components/v2/ui/primitives";
import type { AppStep, PositionShape } from "./types";
import { ApplicantPreview } from "./applicant-preview";
import { HiresBecomeCard } from "./hires-become-card";
import { DetailsTab } from "./details-tab";
import { ApplicationSchemaEditor } from "./application-schema-editor";
import { QuizDesigner } from "./quiz-designer";

type Tab = "details" | "form" | "quiz";

export function EstatePositionEditor({
  mode,
  position,
  applicationCount = 0,
  hireAccountRole = null,
}: {
  mode: "new" | "edit";
  position: PositionShape | null;
  /** Applications for this role (the Applications tab count). */
  applicationCount?: number;
  /** "Hires become" (board "Hiring", 2026-11-16). */
  hireAccountRole?: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useRestorableState<Tab>("position-editor:tab", "details");
  // In create mode the id doesn't exist until Details is saved; the schema tabs
  // stay locked until then so their PATCH endpoints have a real position id.
  const [positionId, setPositionId] = useState<string | null>(position?.id ?? null);
  const [slug, setSlug] = useState<string>(position?.slug ?? "");
  const [title, setTitle] = useState<string>(position?.title ?? "");

  const created = positionId != null;
  const [previewSteps, setPreviewSteps] = useState<AppStep[]>(() => position?.applicationSchema?.steps ?? []);
  const onStepsChange = useCallback((steps: AppStep[]) => setPreviewSteps(steps), []);
  const subtitle = [position?.employmentType, position?.location, `${applicationCount} application${applicationCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ");

  const tabs: Array<{ key: Tab; label: string; icon: React.ReactNode; locked?: boolean }> = [
    { key: "details", label: "Details", icon: <ClipboardList className="h-4 w-4" /> },
    { key: "form", label: "Application form", icon: <ListChecks className="h-4 w-4" />, locked: !created },
    { key: "quiz", label: "Knowledge test", icon: <GraduationCap className="h-4 w-4" />, locked: !created },
  ];

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow={<Link href="/v2/admin/hiring" className="underline-offset-2 hover:underline">← Hiring</Link>}
        title={title || (mode === "new" ? "Untitled role" : "Role")}
        description={mode === "new" ? "Save the details to start the application form and knowledge test." : subtitle}
        actions={
          created && slug ? (
            <EButton variant="outline" size="sm" asChild>
              <a href={`/apply/${slug}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden />
                Preview as applicant
              </a>
            </EButton>
          ) : undefined
        }
      />

      {/* Tab bar */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex min-w-full items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={t.locked}
              onClick={() => setTab(t.key)}
              className={
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] tracking-[0.01em] transition-colors duration-[160ms] disabled:cursor-not-allowed disabled:opacity-40 " +
                (tab === t.key
                  ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                  : "text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-surface))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              {t.icon}
              {t.label}
              {t.locked ? (
                <EBadge tone="neutral" className="ml-1">
                  Save details first
                </EBadge>
              ) : null}
            </button>
          ))}
          {created ? (
            <Link href="/v2/admin/hiring" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-surface))] hover:text-[hsl(var(--e-foreground))]">
              <Users className="h-4 w-4" aria-hidden /> Applications {applicationCount}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
      {tab === "details" ? (
        <DetailsTab
          mode={mode}
          position={position}
          positionId={positionId}
          onCreated={(p) => {
            setPositionId(p.id);
            setSlug(p.slug ?? "");
            setTitle(p.title ?? "");
            // Rewrite the URL to the real id so refreshes land on the saved role.
            router.replace(`/v2/admin/hiring/positions/${p.id}`);
          }}
          onSaved={(p) => {
            setSlug(p.slug ?? "");
            setTitle(p.title ?? "");
          }}
        />
      ) : null}

      {tab === "form" && created ? (
        <ApplicationSchemaEditor positionId={positionId!} position={position} onStepsChange={onStepsChange} />
      ) : null}

      {tab === "quiz" && created ? (
        <QuizDesigner positionId={positionId!} position={position} />
      ) : null}
      </div>
      <aside aria-label="Role summary" className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
        {tab === "form" && created ? <ApplicantPreview title={title} steps={previewSteps} /> : null}
        <HiresBecomeCard
          positionId={positionId}
          title={title}
          initial={hireAccountRole}
          summary="Title, public link, description, department, location, employment type, flyer image, accepting applications, knowledge test on or off with pass mark."
        />
      </aside>
      </div>
    </div>
  );
}
