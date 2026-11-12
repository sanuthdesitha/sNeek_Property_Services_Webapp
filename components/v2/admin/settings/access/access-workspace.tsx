"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { accessWithin, isAdministrator, type AccessSubject } from "@/lib/rbac/access-evaluator";
import { changedPeople } from "@/lib/rbac/access-draft";
import { isAdminPerson, isOfficePerson, isStale, type AccessPerson, type AccessScreenData } from "@/lib/rbac/access-screen-types";
import { listPresets, opsPolicySchema } from "@/lib/rbac/ops-policy";
import { AccessAssistantTeam } from "./access-assistant-team";
import { AccessByArea } from "./access-by-area";
import { AccessCopyDialog } from "./access-copy-dialog";
import { AccessHistoryTab } from "./access-history-tab";
import { displayName } from "./access-labels";
import { AccessPeopleList, type AccessSelection } from "./access-people-list";
import { AccessPersonPane } from "./access-person-pane";
import { AccessPresetsTab } from "./access-presets-tab";
import { AccessSaveDialog, AccessUnsavedBar, rebaseDraft, type SaveConflict } from "./access-save";
import { AccessTabs, type AccessTab } from "./access-tabs";
import { useAccessDraft } from "./use-access-draft";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: AccessScreenData };

function subjectOf(person: AccessPerson): AccessSubject {
  return { id: person.id, role: person.role, heldRoles: person.heldRoles };
}

export function AccessWorkspace({ initialTab = "person" }: { initialTab?: AccessTab }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<AccessTab>(initialTab);
  const [selection, setSelection] = useState<AccessSelection | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState<SaveConflict | null>(null);
  const [notice, setNotice] = useState("");
  const drafts = useAccessDraft();

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetch("/api/admin/ops-permissions", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error || "Could not load access settings.");
        const data = { ...(body as AccessScreenData), policy: opsPolicySchema.parse(body.policy) };
        setLoad({ status: "ready", data });
        drafts.reset(data.policy);
        setSelection((current) => current ?? firstSelection(data));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: cause instanceof Error ? cause.message : "Could not load access settings." });
      });
    return () => controller.abort();
    // drafts.reset is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const data = load.status === "ready" ? load.data : null;
  const saved = drafts.saved;
  const draft = drafts.draft;
  const viewer = useMemo(() => data?.people.find((person) => person.id === data.viewer.id) ?? null, [data]);
  const names = useMemo(() => Object.fromEntries((data?.people ?? []).map((person) => [person.id, displayName(person)])), [data]);
  const unsaved = useMemo(() => new Set(saved && draft ? changedPeople(draft, saved) : []), [draft, saved]);
  const stale = useMemo(() => new Set((data?.people ?? []).filter((person) => isStale(data?.history ?? [], person, new Date())).map((person) => person.id)), [data]);

  const canEdit = useCallback(
    (person: AccessPerson) => {
      if (!data || !saved || saving || conflict) return false;
      if (isAdminPerson(person) || person.id === data.viewer.id) return false;
      if (data.viewer.isAdmin) return true;
      return viewer !== null && !isAdministrator(subjectOf(person)) && accessWithin(saved, subjectOf(person), subjectOf(viewer));
    },
    [data, saved, saving, conflict, viewer],
  );

  if (load.status === "loading") return <p role="status">Loading access…</p>;
  if (load.status === "error" || !data || !saved || !draft) {
    return (
      <div className="space-y-3">
        <EAlert tone="danger" title="Could not load access settings">{load.status === "error" ? load.message : "Try again."}</EAlert>
        <EButton variant="outline" onClick={() => setReload((value) => value + 1)}>Try again</EButton>
      </div>
    );
  }

  const office = data.people.filter(isOfficePerson);
  const selectedPerson = selection?.kind === "person" ? office.find((person) => person.id === selection.id) ?? null : null;
  const selectedTeam = selection?.kind === "team" ? data.assistantTeams.find((team) => team.id === selection.id) ?? null : null;
  const dirty = unsaved.size > 0 || JSON.stringify(draft.presets) !== JSON.stringify(saved.presets);

  async function save(security: { pin?: string; password?: string }) {
    if (!draft) return;
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/admin/ops-permissions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy: draft, security }) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && body.current) {
        setConflict({ current: opsPolicySchema.parse(body.current) });
        return;
      }
      if (!response.ok) throw new Error(body.error || "Could not save access.");
      drafts.reset(opsPolicySchema.parse(body.policy));
      setSaveOpen(false);
      setNotice("Access saved. Each person's next request uses it.");
      setReload((value) => value + 1);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save access.");
    } finally {
      setSaving(false);
    }
  }

  function select(next: AccessSelection) {
    setSelection(next);
    setNotice("");
    if (next.kind === "team") setTab("assistants");
    else if (tab === "assistants") setTab("person");
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="e-display-md">Access and permissions</h1>
          <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Who can do what in the office · {office.length} people with office access{unsaved.size ? ` · ${unsaved.size} unsaved ${unsaved.size === 1 ? "change" : "changes"}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <EButton variant="outline" size="sm" onClick={() => setTab("presets")}>Presets</EButton>
          <EButton variant="outline" size="sm" disabled={!selectedPerson || !canEdit(selectedPerson)} onClick={() => setCopyOpen(true)}>Copy access from…</EButton>
          {data.viewer.isAdmin ? <EButton asChild size="sm"><a href="/v2/admin/accounts">Give office access</a></EButton> : null}
        </div>
      </header>
      {notice ? <EAlert tone="success" title={notice} /> : null}
      <AccessTabs active={tab} counts={{ person: office.length, presets: listPresets(draft).length, assistants: data.assistantTeams.reduce((sum, team) => sum + team.memberCount, 0) }} onSelect={setTab} />

      {tab === "area" ? <AccessByArea people={office} draft={draft} saved={saved} editable={canEdit} onLevel={drafts.setLevel} /> : null}
      {tab === "presets" ? <AccessPresetsTab draft={draft} saved={saved} selectedPersonId={selectedPerson && !isAdminPerson(selectedPerson) ? selectedPerson.id : null} editable={data.viewer.isAdmin && !saving && !conflict} onChange={drafts.replace} /> : null}
      {tab === "history" ? <AccessHistoryTab history={data.history} names={names} presetNames={Object.fromEntries(draft.presets.map((preset) => [preset.id, preset.name]))} timeZone={data.timeZone} /> : null}
      {tab === "person" || tab === "assistants" ? (
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
          <AccessPeopleList people={office} teams={data.assistantTeams} ownPortalCounts={data.ownPortalCounts} draft={draft} selection={selection} unsaved={unsaved} stale={stale} disabled={saving} onSelect={select} />
          {selectedTeam ? (
            <div className="min-w-0 flex-1"><AccessAssistantTeam key={selectedTeam.id} team={selectedTeam} canManage onSaved={() => undefined} /></div>
          ) : selectedPerson ? (
            <AccessPersonPane
              key={selectedPerson.id}
              person={selectedPerson}
              data={data}
              draft={draft}
              saved={saved}
              names={names}
              editable={canEdit(selectedPerson)}
              busy={saving}
              onDraft={drafts}
              onCopy={() => setCopyOpen(true)}
              onReview={() => { setSaveError(""); setSaveOpen(true); }}
            />
          ) : (
            <p className="p-4 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Choose a person or a client assistant team.</p>
          )}
        </div>
      ) : null}
      {tab !== "person" && tab !== "assistants" ? (
        <AccessUnsavedBar saved={saved} draft={draft} names={names} busy={saving} onDiscard={() => drafts.discard()} onReview={() => { setSaveError(""); setSaveOpen(true); }} />
      ) : null}

      <AccessCopyDialog open={copyOpen} target={selectedPerson} people={office} draft={draft} onClose={() => setCopyOpen(false)} onCopy={(fromId) => { if (selectedPerson) drafts.copy(fromId, selectedPerson.id); setCopyOpen(false); }} />
      <AccessSaveDialog
        open={saveOpen && dirty}
        saved={saved}
        draft={draft}
        names={names}
        busy={saving}
        error={saveError}
        conflict={conflict}
        onClose={() => { if (!saving) { setSaveOpen(false); } }}
        onSave={(security) => void save(security)}
        onKeepMine={() => { if (conflict) { drafts.rebase(conflict.current, rebaseDraft(saved, draft, conflict.current)); setConflict(null); } }}
        onTakeTheirs={() => { if (conflict) { drafts.reset(conflict.current); setConflict(null); setSaveOpen(false); } }}
      />
    </div>
  );
}

function firstSelection(data: AccessScreenData): AccessSelection | null {
  const editable = data.people.find((person) => !isAdminPerson(person) && isOfficePerson(person));
  const first = editable ?? data.people[0];
  if (first) return { kind: "person", id: first.id };
  return data.assistantTeams[0] ? { kind: "team", id: data.assistantTeams[0].id } : null;
}
