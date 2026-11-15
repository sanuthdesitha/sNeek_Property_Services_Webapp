"use client";

/**
 * Marketing › Social posts › Create from jobs (2026-11-17, boards
 * "Social generator" and "M-Social generator"). Four steps: pick photos,
 * format, captions and alt text, review and post. The draft lives on the
 * server (?group=<id> in the URL); edits not saved yet stay on screen when a
 * save fails or another step is opened, and reset when another draft opens.
 * Reads are cancelled when replaced and checked after parsing. Fields freeze
 * while a change is being saved.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { SOCIAL_NETWORK_KEYS, type SocialNetwork } from "@/lib/marketing/social/networks";
import type { AccountView, CandidateList, CandidatePhoto, GroupView } from "@/lib/marketing/social/view-types";
import { GeneratorPhotos, type CandidateFilters, type CandidateLoad, MAX_CHOSEN } from "./generator-photos";
import { GeneratorFormat, type CopiesState, type FormatChange } from "./generator-format";
import { GeneratorCaptions, parseHashtags, type AiState, type CaptionDrafts } from "./generator-captions";
import { GeneratorReview, type AccountsLoad } from "./generator-review";
import { isAbort, socialRequest, SOCIAL_API, writeGeneratorParams } from "./social-api";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4;

const STEPS: Array<{ step: Step; label: string; short: string }> = [
  { step: 1, label: "Pick photos", short: "Photos" },
  { step: 2, label: "Format", short: "Preview" },
  { step: 3, label: "Captions and alt text", short: "Caption" },
  { step: 4, label: "Review and post", short: "Post" },
];

function draftsFrom(group: GroupView): CaptionDrafts {
  const drafts = {} as CaptionDrafts;
  for (const network of SOCIAL_NETWORK_KEYS) {
    const post = group.posts.find((row) => row.network === network);
    drafts[network] = { caption: post?.caption ?? "", hashtags: (post?.hashtags ?? []).join(" ") };
  }
  return drafts;
}

function sameDrafts(group: GroupView, drafts: CaptionDrafts | null, alt: Record<string, string>): boolean {
  if (!drafts) return true;
  const saved = draftsFrom(group);
  const captionsSame = SOCIAL_NETWORK_KEYS.every((network) => saved[network].caption === drafts[network].caption && parseHashtags(saved[network].hashtags).join(" ") === parseHashtags(drafts[network].hashtags).join(" "));
  const altSame = group.photos.every((photo) => (alt[photo.photoId] ?? photo.altText) === photo.altText);
  return captionsSame && altSame;
}

export function SocialGenerator({ initialGroupId, timeZone, onClose }: { initialGroupId: string | null; timeZone: string; onClose: () => void }) {
  const [step, setStep] = React.useState<Step>(initialGroupId ? 4 : 1);
  const [groupId, setGroupId] = React.useState<string | null>(initialGroupId);
  const [group, setGroup] = React.useState<GroupView | null>(null);
  const [groupError, setGroupError] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<CandidateFilters>({ days: 30, ratio: "4:5", includeBefore: false, hideUsed: false, listingFirst: true });
  const [load, setLoad] = React.useState<CandidateLoad>({ state: "loading" });
  const [chosen, setChosen] = React.useState<CandidatePhoto[]>([]);
  const [beforeTicks, setBeforeTicks] = React.useState<string[]>([]);
  const [reviewed, setReviewed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "problem" | "good"; text: string; problems?: string[] } | null>(null);
  const [copies, setCopies] = React.useState<CopiesState>({ state: "idle" });
  const [drafts, setDrafts] = React.useState<CaptionDrafts | null>(null);
  const [altDrafts, setAltDrafts] = React.useState<Record<string, string>>({});
  const [captionError, setCaptionError] = React.useState<string | null>(null);
  const [templates, setTemplates] = React.useState<Array<{ key: string; name: string; hooks: number }>>([]);
  const [templateKey, setTemplateKey] = React.useState<string | null>(null);
  const [hookIndex, setHookIndex] = React.useState(0);
  const [ai, setAi] = React.useState<AiState>({ state: "idle" });
  const [accounts, setAccounts] = React.useState<AccountsLoad>({ state: "loading" });
  const [scoring, setScoring] = React.useState(false);
  const candidateRead = React.useRef<AbortController | null>(null);
  const groupRead = React.useRef<AbortController | null>(null);

  const loadCandidates = React.useCallback(async (next: CandidateFilters) => {
    candidateRead.current?.abort();
    const controller = new AbortController();
    candidateRead.current = controller;
    setLoad((current) => (current.state === "ready" ? { ...current, stale: false } : { state: "loading" }));
    const query = new URLSearchParams({ days: String(next.days), ratio: next.ratio, includeBefore: next.includeBefore ? "1" : "0", hideUsed: next.hideUsed ? "1" : "0" });
    try {
      const result = await socialRequest<CandidateList>(`${SOCIAL_API}/candidates?${query}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.ok) setLoad({ state: "ready", list: result.data });
      else setLoad((current) => (current.state === "ready" ? { ...current, stale: true } : { state: "failed", message: result.error }));
    } catch (error) {
      if (!isAbort(error)) setLoad({ state: "failed", message: "Candidate photos could not be loaded." });
    }
  }, []);

  React.useEffect(() => {
    void loadCandidates(filters);
  }, [filters, loadCandidates]);

  React.useEffect(() => () => {
    candidateRead.current?.abort();
    groupRead.current?.abort();
  }, []);

  const applyGroup = React.useCallback((next: GroupView, options: { resetDrafts?: boolean } = {}) => {
    setGroup(next);
    setReviewed(Boolean(next.reviewedAt));
    if (options.resetDrafts) {
      setDrafts(draftsFrom(next));
      setAltDrafts({});
    }
  }, []);

  React.useEffect(() => {
    if (!groupId) return;
    groupRead.current?.abort();
    const controller = new AbortController();
    groupRead.current = controller;
    setGroupError(null);
    void (async () => {
      try {
        const result = await socialRequest<{ group: GroupView }>(`${SOCIAL_API}/groups/${groupId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setGroupError(result.error);
          return;
        }
        applyGroup(result.data.group, { resetDrafts: true });
      } catch (error) {
        if (!isAbort(error)) setGroupError("This draft could not be loaded.");
      }
    })();
    return () => controller.abort();
  }, [groupId, applyGroup]);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [accountResult, templateResult] = await Promise.all([
          socialRequest<{ accounts: AccountView[]; publicAddress: { ok: boolean; problem?: string }; stubbed: boolean }>(`${SOCIAL_API}/accounts`, { signal: controller.signal }),
          socialRequest<{ templates: { templates: Array<{ key: string; name: string; hooks: string[] }> } }>(`${SOCIAL_API}/templates`, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setAccounts(accountResult.ok ? { state: "ready", accounts: accountResult.data.accounts, publicProblem: accountResult.data.publicAddress.ok ? null : accountResult.data.publicAddress.problem ?? null, stubbed: accountResult.data.stubbed } : { state: "failed", message: accountResult.error });
        if (templateResult.ok) setTemplates(templateResult.data.templates.templates.map((item) => ({ key: item.key, name: item.name, hooks: item.hooks.length })));
      } catch (error) {
        if (!isAbort(error)) setAccounts({ state: "failed", message: "Connected accounts could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, []);

  // A loaded draft shows its own photos as chosen.
  React.useEffect(() => {
    if (!group || load.state !== "ready") return;
    const byId = new Map(load.list.photos.map((photo) => [photo.photoId, photo]));
    setChosen(group.photos.map((photo) => byId.get(photo.photoId) ?? {
      photoId: photo.photoId, jobId: "", jobNumber: photo.jobNumber, propertyName: photo.propertyName, room: photo.room, fieldLabel: photo.fieldLabel, fieldKind: photo.fieldKind,
      score: null, scoreWord: "Not scored", components: null, reasons: [], leftOutReason: photo.refusal, state: "usable", usedBefore: false, fits: [], finishedOn: "",
    }));
    setBeforeTicks(group.photos.filter((photo) => photo.beforeCheckedAt).map((photo) => photo.photoId));
  }, [group?.id, group?.revision, load.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = group ? !sameDrafts(group, drafts, altDrafts) : false;
  const posted = Boolean(group?.posts.some((post) => ["PUBLISHED", "SENT_TO_INBOX", "UNCONFIRMED", "SENDING"].includes(post.status)));

  function toggle(photo: CandidatePhoto) {
    setChosen((current) => (current.some((item) => item.photoId === photo.photoId) ? current.filter((item) => item.photoId !== photo.photoId) : current.length >= MAX_CHOSEN ? current : [...current, photo]));
  }

  function move(photoId: string, direction: -1 | 1) {
    setChosen((current) => {
      const index = current.findIndex((item) => item.photoId === photoId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function failed(text: string, problems: string[] = []) {
    setMessage({ tone: "problem", text, problems });
  }

  async function patchGroup(body: Record<string, unknown>): Promise<GroupView | null> {
    if (!group) return null;
    setSaving(true);
    const result = await socialRequest<{ group: GroupView }>(`${SOCIAL_API}/groups/${group.id}`, { method: "PATCH", body: { expectedRevision: group.revision, ...body } });
    setSaving(false);
    if (!result.ok) {
      failed(result.error, result.problems);
      return null;
    }
    applyGroup(result.data.group);
    return result.data.group;
  }

  async function saveReviewed(target: GroupView, value: boolean): Promise<GroupView | null> {
    if (Boolean(target.reviewedAt) === value) return target;
    const result = await socialRequest<{ group: GroupView }>(`${SOCIAL_API}/groups/${target.id}/review`, { method: "POST", body: { expectedRevision: target.revision, reviewed: value } });
    if (!result.ok) {
      failed(result.error);
      return null;
    }
    applyGroup(result.data.group);
    return result.data.group;
  }

  /** Step 1 → 2: create the draft (or change its photos), then record the tick. */
  async function confirmPhotos() {
    if (chosen.length === 0) return;
    setMessage(null);
    const photoIds = chosen.map((photo) => photo.photoId);
    let current = group;
    if (!current) {
      setSaving(true);
      const format = chosen.some((photo) => photo.fieldKind === "BEFORE") ? "BEFORE_AFTER" : chosen.length > 1 ? "CAROUSEL" : "SINGLE";
      const created = await socialRequest<{ groupId: string }>(`${SOCIAL_API}/groups`, { method: "POST", body: { format, ratio: filters.ratio, photoIds } });
      if (!created.ok) {
        setSaving(false);
        failed(created.error, created.problems);
        return;
      }
      const loaded = await socialRequest<{ group: GroupView }>(`${SOCIAL_API}/groups/${created.data.groupId}`);
      setSaving(false);
      if (!loaded.ok) {
        failed(loaded.error);
        return;
      }
      current = loaded.data.group;
      setGroupId(current.id);
      writeGeneratorParams("create", current.id);
      applyGroup(current, { resetDrafts: true });
    } else if (photoIds.join() !== current.photos.map((photo) => photo.photoId).join()) {
      const format = chosen.some((photo) => photo.fieldKind === "BEFORE") ? "BEFORE_AFTER" : chosen.length > 1 ? (current.format === "SINGLE" || current.format === "FRAME" ? "CAROUSEL" : current.format) : current.format === "CAROUSEL" || current.format === "BEFORE_AFTER" ? "SINGLE" : current.format;
      current = await patchGroup({ photoIds, format });
      if (!current) return;
    }
    if (beforeTicks.length && current.photos.some((photo) => photo.role === "BEFORE" && !photo.beforeCheckedAt && beforeTicks.includes(photo.photoId))) {
      current = await patchGroupFrom(current, { beforeChecked: beforeTicks });
      if (!current) return;
    }
    const ticked = await saveReviewed(current, reviewed);
    if (!ticked) return;
    setStep(2);
  }

  async function patchGroupFrom(target: GroupView, body: Record<string, unknown>): Promise<GroupView | null> {
    const result = await socialRequest<{ group: GroupView }>(`${SOCIAL_API}/groups/${target.id}`, { method: "PATCH", body: { expectedRevision: target.revision, ...body } });
    if (!result.ok) {
      failed(result.error, result.problems);
      return null;
    }
    applyGroup(result.data.group);
    return result.data.group;
  }

  async function changeFormat(change: FormatChange) {
    setMessage(null);
    const updated = await patchGroup(change as Record<string, unknown>);
    if (updated && (change.format || change.ratio || change.splitLayout || change.frameText !== undefined)) setCopies({ state: "idle" });
  }

  async function makeCopies() {
    if (!group) return;
    setCopies({ state: "making" });
    const result = await socialRequest<{ group: GroupView }>(`${SOCIAL_API}/groups/${group.id}/derivatives`, { method: "POST" });
    if (!result.ok) {
      setCopies({ state: "failed", message: result.error, problems: result.problems });
      return;
    }
    applyGroup(result.data.group);
    setCopies({ state: "ready" });
  }

  async function saveCaptions(): Promise<boolean> {
    if (!group || !drafts) return true;
    if (!dirty) return true;
    setSaving(true);
    setCaptionError(null);
    const captions = Object.fromEntries(SOCIAL_NETWORK_KEYS.map((network) => [network, { caption: drafts[network].caption, hashtags: parseHashtags(drafts[network].hashtags) }]));
    const altText = Object.fromEntries(group.photos.map((photo) => [photo.photoId, altDrafts[photo.photoId] ?? photo.altText]));
    const result = await socialRequest<{ group: GroupView }>(`${SOCIAL_API}/groups/${group.id}`, { method: "PATCH", body: { expectedRevision: group.revision, captions, altText } });
    setSaving(false);
    if (!result.ok) {
      setCaptionError(result.error);
      return false;
    }
    applyGroup(result.data.group, { resetDrafts: true });
    return true;
  }

  async function regenerate(key: string | null, index: number) {
    if (!group) return;
    setTemplateKey(key);
    setHookIndex(index);
    const updated = await patchGroup({ regenerateCaptions: { templateKey: key, hookIndex: index } });
    if (updated) {
      setDrafts(draftsFrom(updated));
    }
  }

  async function askAi() {
    if (!group) return;
    setAi({ state: "working" });
    const result = await socialRequest<{ state: "ok" | "unavailable"; message?: string; captions?: Partial<Record<SocialNetwork, string>>; altText?: Record<string, string>; problems?: string[]; usedPhotos?: boolean }>(`${SOCIAL_API}/groups/${group.id}/ai`, { method: "POST" });
    if (!result.ok) {
      setAi({ state: "unavailable", message: `${result.error} Your text is unchanged.` });
      return;
    }
    if (result.data.state !== "ok") {
      setAi({ state: "unavailable", message: result.data.message ?? "AI caption help is not available. Templates still work." });
      return;
    }
    setAi({ state: "ready", captions: result.data.captions ?? {}, altText: result.data.altText ?? {}, problems: result.data.problems ?? [], usedPhotos: Boolean(result.data.usedPhotos) });
  }

  function useAi() {
    if (ai.state !== "ready" || !drafts) return;
    const next = { ...drafts };
    for (const network of SOCIAL_NETWORK_KEYS) {
      if (ai.captions[network]) next[network] = { ...next[network], caption: ai.captions[network]! };
    }
    setDrafts(next);
    setAltDrafts((current) => ({ ...current, ...ai.altText }));
    setAi({ state: "idle" });
  }

  async function goTo(target: Step) {
    if (target === step) return;
    if (target > 1 && !group) return;
    if (step === 3 && !(await saveCaptions())) return;
    if (step === 1 && target > 1 && group) {
      await confirmPhotos();
      if (target !== 2) setStep(target);
      return;
    }
    setStep(target);
  }

  function startNew() {
    setGroup(null);
    setGroupId(null);
    setChosen([]);
    setBeforeTicks([]);
    setReviewed(false);
    setDrafts(null);
    setAltDrafts({});
    setAi({ state: "idle" });
    setCopies({ state: "idle" });
    setMessage(null);
    setStep(1);
    writeGeneratorParams("create", null);
  }

  const nextLabel = step === 1 ? "Next: format" : step === 2 ? "Next: captions" : step === 3 ? "Next: review" : null;
  const onNext = () => {
    if (step === 1) void confirmPhotos();
    else if (step === 2) void goTo(3);
    else if (step === 3) void goTo(4);
  };
  const nextDisabled = saving || (step === 1 && chosen.length === 0) || (step === 1 && !reviewed);

  return (
    <div className="min-w-0 space-y-4" data-unsaved={dirty ? "true" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
        <p className="text-[hsl(var(--e-muted-foreground))]">
          {group ? <>{posted ? "Posted · last change" : "Draft saved"} {new Date(group.updatedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", timeZone })} · &quot;{group.title}&quot;{group.createdVia === "AGENT" ? " · drafted by an agent" : ""}</> : "Nothing saved yet: the draft is created when you go to step 2."}
        </p>
        <div className="flex gap-2">
          {group ? <EButton size="sm" variant="ghost" onClick={startNew}>Start a new draft</EButton> : null}
          <EButton size="sm" variant="ghost" onClick={onClose}>Back to posts</EButton>
        </div>
      </div>

      <ol aria-label="Steps" className="grid grid-cols-4 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]">
        {STEPS.map((item) => {
          const current = item.step === step;
          const sub = item.step === 1 ? `${chosen.length} chosen` : item.step === 2 ? group?.format.toLowerCase().replace("_", " ") ?? "–" : item.step === 3 ? "5 networks" : "a person clicks";
          return (
            <li key={item.step} className="min-w-0 border-[hsl(var(--e-border))] [&+li]:border-l">
              <button type="button" aria-label={`Step ${item.step}: ${item.label}, ${sub}`} aria-current={current ? "step" : undefined} disabled={saving || (item.step > 1 && !group)} onClick={() => void goTo(item.step)} className={cn("flex min-h-11 w-full flex-col items-start gap-0.5 px-2 py-2 text-left sm:px-3", current ? "bg-[hsl(var(--e-gold-soft))]" : "")}>
                <span className="text-[0.75rem] font-[650]"><span className="mr-1 e-tnum">{item.step}</span><span className="max-sm:hidden">{item.label}</span><span className="sm:hidden">{item.short}</span></span>
                <span className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))] max-sm:hidden">{sub}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {groupError ? <EToneNotice tone="problem" role="alert" title={groupError}><EButton size="sm" variant="outline" className="mt-2" onClick={startNew}>Start a new draft</EButton></EToneNotice> : null}
      {group && group.photos.some((photo) => photo.refusal) ? (
        <EToneNotice tone="problem" role="alert" title="A photo in this draft can no longer be used.">
          <ul className="list-disc pl-4">{group.photos.filter((photo) => photo.refusal).map((photo) => <li key={photo.photoId}>{photo.room}: {photo.refusal}</li>)}</ul>
          <p className="mt-1">Posting stays off until it is replaced in step 1.</p>
        </EToneNotice>
      ) : null}
      {message ? (
        <EToneNotice tone={message.tone} role={message.tone === "problem" ? "alert" : "status"} title={message.text}>
          {message.problems?.length ? <ul className="list-disc pl-4">{message.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
        </EToneNotice>
      ) : null}

      <section aria-labelledby="social-step-heading" className="min-w-0 space-y-3">
        <h2 id="social-step-heading" className="font-serif text-[1.25rem]"><span className="mr-2 text-[0.75rem] font-sans uppercase tracking-wide text-[hsl(var(--e-muted-foreground))]">Step {step}</span>{STEPS[step - 1].label}</h2>
        {step === 1 ? (
          <GeneratorPhotos
            load={load}
            filters={filters}
            onFilters={setFilters}
            chosen={chosen}
            onToggle={toggle}
            onMove={move}
            onCheckBefore={(photo) => {
              setBeforeTicks((current) => Array.from(new Set([...current, photo.photoId])));
              toggle(photo);
            }}
            reviewed={reviewed}
            onReviewed={setReviewed}
            onRetry={() => void loadCandidates(filters)}
            onScoreNow={async () => {
              setScoring(true);
              await socialRequest(`${SOCIAL_API}/scores`, { method: "POST" });
              setScoring(false);
              void loadCandidates(filters);
            }}
            scoring={scoring}
            frozen={saving || posted}
          />
        ) : null}
        {step === 2 && group ? <GeneratorFormat group={group} onChange={(change) => void changeFormat(change)} copies={copies} onMakeCopies={() => void makeCopies()} frozen={saving || posted} /> : null}
        {step === 3 && group && drafts ? (
          <GeneratorCaptions
            group={group}
            drafts={drafts}
            onDraft={(network, draft) => setDrafts((current) => (current ? { ...current, [network]: draft } : current))}
            altDrafts={altDrafts}
            onAlt={(photoId, text) => setAltDrafts((current) => ({ ...current, [photoId]: text }))}
            templates={templates}
            templateKey={templateKey}
            hookIndex={hookIndex}
            onTemplate={(key, index) => void regenerate(key, index)}
            ai={ai}
            onAi={() => void askAi()}
            onUseAi={useAi}
            saving={saving}
            saveError={captionError}
            onSave={() => void saveCaptions()}
            dirty={dirty}
            frozen={saving || posted}
          />
        ) : null}
        {step === 4 && group ? <GeneratorReview group={group} accounts={accounts} dirty={dirty} timeZone={timeZone} onGroup={(next) => applyGroup(next)} onError={(text) => failed(text)} /> : null}
      </section>

      {nextLabel ? (
        <div className="flex justify-end max-sm:hidden">
          <EButton onClick={onNext} disabled={nextDisabled}>{saving ? "Saving…" : nextLabel}</EButton>
        </div>
      ) : null}
      {nextLabel ? <EPhoneActionBar label="Social post steps" primary={<EButton onClick={onNext} disabled={nextDisabled}>{saving ? "Saving…" : nextLabel}</EButton>} /> : null}
    </div>
  );
}
