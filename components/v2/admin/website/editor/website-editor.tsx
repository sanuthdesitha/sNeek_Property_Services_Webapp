"use client";

/**
 * Website › Pages editor (board "Website and blog", 2026-11-16).
 *
 * Three panes: sections with a count of unsaved changes, the form with changed
 * fields outlined, and a live preview fed the unsaved draft. One dark bar holds
 * "Save and publish" and "Discard…". Publishing goes through
 * PATCH /api/admin/settings ({ websiteContent, websiteRevision }), which needs
 * ADMIN, refuses images without alt text and refuses a draft started before
 * someone else published (the draft is kept and compared). The draft is kept
 * on this browser until it is published or discarded. Images use
 * /api/uploads/direct. Owner default (pending owner confirmation): publish
 * straight away; older versions are restored from Settings › audit.
 */
import * as React from "react";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { toast } from "@/hooks/use-toast";
import { DEFAULT_WEBSITE_CONTENT, sanitizeWebsiteContent, type WebsiteContent } from "@/lib/public-site/content";
import {
  WEBSITE_SECTIONS,
  altTextRefusal,
  changeCountsBySection,
  describeChanges,
  diffWebsiteContent,
  isWebsiteSectionKey,
  missingImageAltText,
  previewBlocksFor,
  type AltTextIssue,
  type WebsiteSectionKey,
} from "@/lib/public-site/website-draft";
import { formatOrgDateTime } from "@/lib/public-site/zoned-time";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { undoToast } from "@/components/v2/ui/undo-toast";
import { toneMutedClass, toneNoticeClass } from "@/components/v2/ui/tone-band";
import { cloneContent, LibraryImagesProvider, type LibraryImage } from "./shared";
import { WebsiteChangesProvider } from "./changes-context";
import { WebsitePreviewPane } from "./preview-pane";
import { HomeSection } from "./sections/home-section";
import { PagesCopySection } from "./sections/pages-copy-section";
import { ContactSection } from "./sections/contact-section";
import { LegalSection } from "./sections/legal-section";
import { WhyFaqSection } from "./sections/why-faq-section";
import { MediaSection } from "./sections/media-section";
import { ServicePagesSection } from "./sections/service-pages-section";
import { LayoutSection } from "./sections/layout-section";
import { RawJsonSection } from "./sections/raw-json-section";

export type { LibraryImage };

type StoredDraft = { baseRevision: string; content: unknown; savedAt: string };

type PublishOutcome =
  | { kind: "published" }
  | { kind: "error"; message: string }
  | { kind: "alt"; issues: AltTextIssue[] };

type Conflict = {
  byName: string | null;
  at: string | null;
  content: WebsiteContent;
  revision: string;
};

type PhonePane = "edit" | "preview";

function draftKey(ownerId: string) {
  return `sneek:website-draft:v1:${ownerId}`;
}

function readStoredDraft(ownerId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(ownerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    return parsed && typeof parsed.baseRevision === "string" && parsed.content ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredDraft(ownerId: string, draft: StoredDraft | null) {
  try {
    if (draft) window.localStorage.setItem(draftKey(ownerId), JSON.stringify(draft));
    else window.localStorage.removeItem(draftKey(ownerId));
  } catch {
    /* storage unavailable: the draft lives only in this tab */
  }
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export function WebsiteCmsEditor({
  initialContent,
  initialRevision,
  readOnly,
  draftOwnerId,
  libraryImages = [],
  timeZone,
}: {
  initialContent: WebsiteContent;
  initialRevision: string;
  readOnly: boolean;
  /** Keys this person's browser draft (never shared between accounts). */
  draftOwnerId: string;
  libraryImages?: LibraryImage[];
  timeZone: string;
}) {
  const [published, setPublished] = React.useState<WebsiteContent>(() => cloneContent(initialContent));
  const [revision, setRevision] = React.useState(initialRevision);
  const [draft, setDraft] = React.useState<WebsiteContent>(() => cloneContent(initialContent));
  const [storedSection, setStoredSection] = useRestorableState<string>("website-editor:section", "home");
  const section: WebsiteSectionKey = isWebsiteSectionKey(storedSection) ? storedSection : "home";
  const [phonePane, setPhonePane] = React.useState<PhonePane>("edit");
  const [saving, setSaving] = React.useState(false);
  const [outcome, setOutcome] = React.useState<PublishOutcome | null>(null);
  const [conflict, setConflict] = React.useState<Conflict | null>(null);
  const [showCompare, setShowCompare] = React.useState(false);
  const [restoredCount, setRestoredCount] = React.useState<number | null>(null);
  const [uploadingKey, setUploadingKey] = React.useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [loadTheirsOpen, setLoadTheirsOpen] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  const changedPaths = React.useMemo(() => diffWebsiteContent(published, draft), [published, draft]);
  const counts = React.useMemo(() => changeCountsBySection(changedPaths), [changedPaths]);
  const highlight = React.useMemo(() => previewBlocksFor(changedPaths), [changedPaths]);
  const changeCount = changedPaths.length;
  const activeMeta = WEBSITE_SECTIONS.find((item) => item.key === section) ?? WEBSITE_SECTIONS[0]!;

  // Bring back a draft this person left on this browser (after hydration).
  React.useEffect(() => {
    if (!readOnly) {
      const stored = readStoredDraft(draftOwnerId);
      if (stored) {
        const content = sanitizeWebsiteContent(stored.content, initialContent);
        const restored = diffWebsiteContent(initialContent, content).length;
        if (restored > 0) {
          setDraft(content);
          setRevision(stored.baseRevision);
          setRestoredCount(restored);
        } else {
          writeStoredDraft(draftOwnerId, null);
        }
      }
    }
    setHydrated(true);
    // Mount only: the stored draft belongs to the content this page loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the draft on this browser until it is published or discarded.
  React.useEffect(() => {
    if (!hydrated || readOnly) return;
    const timer = window.setTimeout(() => {
      writeStoredDraft(draftOwnerId, changeCount > 0 ? { baseRevision: revision, content: draft, savedAt: new Date().toISOString() } : null);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [hydrated, readOnly, draftOwnerId, changeCount, revision, draft]);

  // Leaving the page with changes asks first (the draft also stays on this browser).
  React.useEffect(() => {
    if (readOnly || changeCount === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [readOnly, changeCount]);

  const handleUpload = React.useCallback(
    async (key: string, file: File, apply: (url: string) => void) => {
      if (readOnly) return;
      setUploadingKey(key);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("folder", "website");
        const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.url) throw new Error(body.error ?? "Could not upload the image.");
        apply(body.url as string);
        toast({ title: "Image added to the draft", description: "Add its alt text, then save and publish." });
      } catch (error) {
        toast({ title: "Image not uploaded", description: error instanceof Error ? error.message : "Could not upload the image.", variant: "destructive" });
      } finally {
        setUploadingKey(null);
      }
    },
    [readOnly]
  );

  async function publish() {
    if (readOnly || saving || changeCount === 0) return;
    const issues = missingImageAltText(draft);
    if (issues.length > 0) {
      setOutcome({ kind: "alt", issues });
      return;
    }
    setSaving(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteContent: draft, websiteRevision: revision }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body?.code === "website_changed") {
        setConflict({
          byName: typeof body.publishedByName === "string" ? body.publishedByName : null,
          at: typeof body.publishedAt === "string" ? body.publishedAt : null,
          content: sanitizeWebsiteContent(body.websiteContent, published),
          revision: String(body.websiteRevision ?? ""),
        });
        setShowCompare(false);
        setOutcome({ kind: "error", message: "Nothing was published. Someone else published the website after you started; your changes are kept." });
        return;
      }
      if (res.status === 400 && body?.code === "alt_text_missing" && Array.isArray(body.issues)) {
        setOutcome({ kind: "alt", issues: body.issues as AltTextIssue[] });
        return;
      }
      if (!res.ok) {
        setOutcome({ kind: "error", message: `Nothing was published. ${body?.error ?? "The server refused the change."}` });
        return;
      }
      const saved = sanitizeWebsiteContent(body.websiteContent ?? draft, draft);
      setPublished(saved);
      setDraft(cloneContent(saved));
      if (typeof body.websiteRevision === "string") setRevision(body.websiteRevision);
      writeStoredDraft(draftOwnerId, null);
      setConflict(null);
      setRestoredCount(null);
      setOutcome({ kind: "published" });
    } catch {
      setOutcome({ kind: "error", message: "Nothing was published. The connection failed; your changes are kept." });
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    const previous = draft;
    setDraft(cloneContent(published));
    setDiscardOpen(false);
    setOutcome(null);
    undoToast({ title: `${plural(changeCount, "change")} discarded`, description: "The live site was not changed.", onUndo: () => setDraft(previous) });
  }

  function keepMine() {
    if (!conflict) return;
    setPublished(conflict.content);
    setRevision(conflict.revision);
    setConflict(null);
    setOutcome(null);
  }

  function loadTheirs() {
    if (!conflict) return;
    setPublished(conflict.content);
    setDraft(cloneContent(conflict.content));
    setRevision(conflict.revision);
    setConflict(null);
    setLoadTheirsOpen(false);
    setOutcome(null);
  }

  const sectionProps = { content: draft, setContent: setDraft, readOnly, uploadingKey, handleUpload };
  const summary = changeCount > 0 ? describeChanges(changedPaths) : "";
  const conflictName = conflict?.byName ?? "Someone";
  const conflictTime = conflict?.at ? formatOrgDateTime(conflict.at, timeZone) : null;

  return (
    <div className="space-y-4" data-unsaved={!readOnly && changeCount > 0 ? "true" : undefined}>
      {readOnly ? (
        <EAlert tone="info" title="Read only">
          Only administrators can publish website changes. The preview still works.
        </EAlert>
      ) : (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-sidebar-bg))] px-4 py-2.5 text-[hsl(var(--e-sidebar-fg))]"
        >
          <b className="text-[0.875rem]">{saving ? "Publishing…" : changeCount > 0 ? plural(changeCount, "unsaved change") : "No unsaved changes"}</b>
          <span className="min-w-0 flex-1 text-[0.8125rem] opacity-85 [overflow-wrap:anywhere]">
            {changeCount > 0
              ? `${summary}. The preview already shows them; the live site does not.`
              : "The live site matches this editor."}
          </span>
          <span className="flex shrink-0 gap-2 max-sm:hidden">
            <EButton
              variant="outline"
              size="sm"
              className="border-[hsl(var(--e-sidebar-hairline))] bg-transparent text-[hsl(var(--e-sidebar-fg))] hover:bg-[hsl(var(--e-sidebar-active-bg))]"
              disabled={saving || changeCount === 0}
              onClick={() => setDiscardOpen(true)}
            >
              Discard…
            </EButton>
            <EButton variant="gold" size="sm" disabled={saving || changeCount === 0} onClick={() => void publish()}>
              {saving ? "Publishing…" : "Save and publish"}
            </EButton>
          </span>
        </div>
      )}

      {restoredCount !== null && changeCount > 0 ? (
        <p role="status" className={`rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass("info")}`}>
          {plural(restoredCount, "unsaved change")} kept on this browser from your last visit {restoredCount === 1 ? "is" : "are"} back in the draft.
        </p>
      ) : null}

      {conflict ? (
        <div role="alert" className={`space-y-2 rounded-[var(--e-radius-lg)] p-3 ${toneNoticeClass("attention")}`}>
          <p className="text-[0.875rem] font-[600]">
            {conflictName} published the website{conflictTime ? ` at ${conflictTime}` : ""}.
          </p>
          <p className={`text-[0.8125rem] ${toneMutedClass("attention")}`}>
            Your changes stay. Compare, then keep yours (publish them over the new version) or load the published version.
          </p>
          <div className="flex flex-wrap gap-2">
            <EButton variant="outline" size="sm" aria-expanded={showCompare} onClick={() => setShowCompare((value) => !value)}>
              {showCompare ? "Hide comparison" : "Compare"}
            </EButton>
            <EButton size="sm" onClick={keepMine}>Keep mine</EButton>
            <EButton variant="outline" size="sm" onClick={() => setLoadTheirsOpen(true)}>Load the published version</EButton>
          </div>
          {showCompare ? (
            <p className="text-[0.8125rem] [overflow-wrap:anywhere]">
              {(() => {
                const differences = diffWebsiteContent(conflict.content, draft);
                return differences.length
                  ? `Publishing yours would change: ${describeChanges(differences)}.`
                  : "Your draft and the published version are the same.";
              })()}
            </p>
          ) : null}
        </div>
      ) : null}

      {outcome?.kind === "published" ? (
        <p role="status" className={`rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass("good")}`}>
          Published. The live site now shows these changes. Older versions can be restored from Settings › audit.
        </p>
      ) : null}
      {outcome?.kind === "error" ? (
        <p role="alert" className={`rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass("problem")}`}>
          {outcome.message}
        </p>
      ) : null}
      {outcome?.kind === "alt" ? (
        <div role="alert" className={`space-y-2 rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass("problem")}`}>
          <p>{altTextRefusal(outcome.issues)}</p>
          <ul className="flex flex-wrap gap-2">
            {outcome.issues.map((issue) => (
              <li key={issue.path}>
                <EButton variant="outline" size="sm" onClick={() => setStoredSection(issue.section)}>
                  Go to {issue.label}
                </EButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <WebsiteChangesProvider value={{ published, paths: changedPaths }}>
        <LibraryImagesProvider images={libraryImages}>
          {/* Phones and tablets: a labelled section selector and Edit / Preview steps. */}
          <div className="space-y-2 lg:hidden">
            <label className="block space-y-1">
              <span className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Section</span>
              <select
                className="h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[1rem] sm:text-[0.875rem]"
                value={section}
                disabled={saving}
                onChange={(event) => setStoredSection(event.target.value)}
              >
                {WEBSITE_SECTIONS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                    {counts[item.key] ? ` (${counts[item.key]} unsaved)` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div role="group" aria-label="Editor panes" className="grid grid-cols-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-0.5">
              {(["edit", "preview"] as const).map((pane) => (
                <button
                  key={pane}
                  type="button"
                  aria-pressed={phonePane === pane}
                  onClick={() => setPhonePane(pane)}
                  className={`min-h-11 rounded-[var(--e-radius-sm)] text-[0.875rem] ${
                    phonePane === pane ? "bg-[hsl(var(--e-surface))] font-[600] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))]"
                  }`}
                >
                  {pane === "edit" ? "Edit" : "Preview"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,380px)] xl:grid-cols-[200px_minmax(0,1fr)_minmax(0,430px)]">
            <nav aria-label="Website sections" className="hidden flex-col gap-0.5 border-r border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2 lg:flex">
              {WEBSITE_SECTIONS.map((item) => {
                const on = item.key === section;
                const count = counts[item.key] ?? 0;
                return (
                  <button
                    key={item.key}
                    type="button"
                    disabled={saving}
                    aria-current={on ? "true" : undefined}
                    onClick={() => setStoredSection(item.key)}
                    className={`flex min-h-9 items-center justify-between gap-1.5 rounded-[var(--e-radius-sm)] px-2.5 text-left text-[0.8125rem] disabled:opacity-60 ${
                      item.key === "json" ? "mt-2 rounded-none border-t border-[hsl(var(--e-border))] pt-2 text-[hsl(var(--e-muted-foreground))]" : ""
                    } ${on ? "bg-[hsl(var(--e-surface))] font-[600] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-surface))]"}`}
                  >
                    <span className="min-w-0">{item.label}</span>
                    {count > 0 ? (
                      <span className="shrink-0 whitespace-nowrap text-[0.625rem] font-[600] text-[hsl(var(--e-warning))]">
                        <span aria-hidden>● </span>
                        {count}
                        <span className="sr-only"> unsaved</span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
              <p className="px-2.5 pt-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Restore an older version from Settings › audit.</p>
            </nav>

            <fieldset
              disabled={saving}
              className={`min-w-0 space-y-3 border-0 p-4 lg:border-r lg:border-[hsl(var(--e-border))] ${phonePane === "edit" ? "" : "max-lg:hidden"}`}
            >
              <legend className="sr-only">{activeMeta.label}</legend>
              <div>
                <h2 className="text-[0.9375rem] font-[600]">{activeMeta.label}</h2>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{activeMeta.summary}</p>
              </div>
              {section === "home" ? <HomeSection {...sectionProps} /> : null}
              {section === "pages" ? <PagesCopySection {...sectionProps} /> : null}
              {section === "contact" ? <ContactSection {...sectionProps} /> : null}
              {section === "legal" ? <LegalSection {...sectionProps} /> : null}
              {section === "trust" ? <WhyFaqSection {...sectionProps} /> : null}
              {section === "media" ? <MediaSection {...sectionProps} /> : null}
              {section === "service-pages" ? <ServicePagesSection {...sectionProps} services={MARKETED_SERVICES} /> : null}
              {section === "layout" ? <LayoutSection {...sectionProps} /> : null}
              {section === "json" ? (
                <RawJsonSection content={draft} setContent={setDraft} readOnly={readOnly} defaults={DEFAULT_WEBSITE_CONTENT} />
              ) : null}
            </fieldset>

            <div className={`min-w-0 bg-[hsl(var(--e-surface-sunken))] p-3 ${phonePane === "preview" ? "" : "max-lg:hidden"}`}>
              <WebsitePreviewPane draft={draft} highlight={highlight} />
            </div>
          </div>
        </LibraryImagesProvider>
      </WebsiteChangesProvider>

      {!readOnly ? (
        <EPhoneActionBar
          label="Website actions"
          secondary={
            <EButton variant="outline" disabled={saving || changeCount === 0} onClick={() => setDiscardOpen(true)}>
              Discard…
            </EButton>
          }
          primary={
            <EButton variant="gold" disabled={saving || changeCount === 0} onClick={() => void publish()}>
              {saving ? "Publishing…" : changeCount > 0 ? `Save and publish (${changeCount})` : "Save and publish"}
            </EButton>
          }
        />
      ) : null}

      <EConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        tier="destructive"
        title={`Discard ${plural(changeCount, "unsaved change")}?`}
        description="The draft goes back to what the live site shows now. You can undo for 10 seconds."
        confirmLabel="Discard changes"
        onConfirm={discard}
      />
      <EConfirmDialog
        open={loadTheirsOpen}
        onClose={() => setLoadTheirsOpen(false)}
        tier="destructive"
        title="Load the published version?"
        description={`Your ${plural(changeCount, "unsaved change")} are replaced by what ${conflictName} published. This cannot be undone.`}
        confirmLabel="Replace my draft"
        onConfirm={loadTheirs}
      />
    </div>
  );
}
