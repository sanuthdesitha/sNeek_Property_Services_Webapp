"use client";

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
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, ClipboardList, ListChecks, GraduationCap } from "lucide-react";
import { EButton, EPageHeader, EBadge } from "@/components/v2/ui/primitives";
import type { PositionShape } from "./types";
import { DetailsTab } from "./details-tab";
import { ApplicationSchemaEditor } from "./application-schema-editor";
import { QuizDesigner } from "./quiz-designer";

type Tab = "details" | "form" | "quiz";

export function EstatePositionEditor({
  mode,
  position,
}: {
  mode: "new" | "edit";
  position: PositionShape | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("details");
  // In create mode the id doesn't exist until Details is saved; the schema tabs
  // stay locked until then so their PATCH endpoints have a real position id.
  const [positionId, setPositionId] = useState<string | null>(position?.id ?? null);
  const [slug, setSlug] = useState<string>(position?.slug ?? "");
  const [title, setTitle] = useState<string>(position?.title ?? "");

  const created = positionId != null;

  const tabs: Array<{ key: Tab; label: string; icon: React.ReactNode; locked?: boolean }> = [
    { key: "details", label: "Details", icon: <ClipboardList className="h-4 w-4" /> },
    { key: "form", label: "Application form", icon: <ListChecks className="h-4 w-4" />, locked: !created },
    { key: "quiz", label: "Knowledge test", icon: <GraduationCap className="h-4 w-4" />, locked: !created },
  ];

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow={mode === "new" ? "New role" : "Edit role"}
        title={title || (mode === "new" ? "Untitled role" : "Role")}
        description="Job post, application form, and the knowledge test — one Estate flow."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {created && slug ? (
              <EButton variant="outline" asChild>
                <a href={`/apply/${slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  View apply page
                </a>
              </EButton>
            ) : null}
            <EButton variant="outline" asChild>
              <Link href="/v2/admin/hiring">
                <ArrowLeft className="h-4 w-4" />
                Back to hiring
              </Link>
            </EButton>
          </div>
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
        </div>
      </div>

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
        <ApplicationSchemaEditor positionId={positionId!} position={position} />
      ) : null}

      {tab === "quiz" && created ? (
        <QuizDesigner positionId={positionId!} position={position} />
      ) : null}
    </div>
  );
}
