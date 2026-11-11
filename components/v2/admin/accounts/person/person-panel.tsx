"use client";

/**
 * The person panel (`?open=<userId>`): a column beside the list from lg, a
 * full-height sheet below it. Header as drawn: avatar, name, "Role · since
 * Mon YYYY", Test as and the more menu; then the section tabs.
 */
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EButton } from "@/components/v2/ui/primitives";
import { Avatar, formatMonthYear } from "../hub/account-display";
import { PersonActions } from "./person-actions";
import { PersonTabsView } from "./person-view";
import { loadedOf, usePerson } from "./use-person";

export function PersonPanel({ userId, onClose, onListChanged }: { userId: string; onClose: () => void; onListChanged: () => void }) {
  const { state, reload } = usePerson(userId);
  const loaded = loadedOf(state);
  const profile = loaded?.profile.id === userId ? loaded.profile : null;

  function changed() {
    reload();
    onListChanged();
  }

  return (
    <ESidePanel
      open
      label="Person"
      onClose={onClose}
      className="lg:w-[430px]"
      title={
        profile ? (
          <span className="flex items-center gap-2.5">
            <Avatar name={profile.name} email={profile.email} size={44} />
            <span className="min-w-0">{profile.name ?? profile.email}</span>
          </span>
        ) : state.status === "error" ? "Could not load" : "Loading…"
      }
      subtitle={profile ? `${profile.roleLabel} · since ${formatMonthYear(profile.hireDate ?? profile.createdAt)}` : undefined}
      toolbar={
        profile && loaded ? (
          <PersonActions
            profile={profile}
            caps={loaded.capabilities}
            fullPageHref={`/v2/admin/accounts/users/${profile.id}`}
            onChanged={changed}
            onDeleted={() => {
              onListChanged();
              onClose();
            }}
          />
        ) : null
      }
    >
      {state.status === "loading" && !profile ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading this account…</p> : null}
      {state.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">
          <span>{profile ? `Showing the last loaded details. ${state.message}` : state.message}</span>
          <EButton size="sm" variant="outline" onClick={reload}>Try again</EButton>
        </div>
      ) : null}
      {profile && loaded ? <PersonTabsView profile={profile} caps={loaded.capabilities} onChanged={changed} /> : null}
    </ESidePanel>
  );
}
