"use client";

import * as React from "react";
import { EAlert } from "@/components/v2/ui/primitives";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { NotificationsPhoneBack } from "./phone-back";
import type { CatalogResponse } from "@/lib/notifications/catalog-view-types";
import type { WordingSummary } from "@/lib/notifications/wording/view-types";
import { sendJson, useNotificationRead } from "./use-notification-read";
import { TypeDetails } from "./type-details";
import { TypeList } from "./type-list";
import { WordingWorkspace, type WordingPhoneScreen } from "./wording-workspace";

type SummaryResponse = { summaries: WordingSummary[]; canEdit: boolean; editReason: string | null };

function parseCatalog(body: unknown): CatalogResponse {
  const value = body as Partial<CatalogResponse> | null;
  if (!value || !Array.isArray(value.types)) throw new Error("bad catalog");
  return { types: value.types, controlsUpdatedAt: value.controlsUpdatedAt ?? null };
}

function parseSummaries(body: unknown): SummaryResponse {
  const value = body as Partial<SummaryResponse> | null;
  if (!value || !Array.isArray(value.summaries)) throw new Error("bad summaries");
  return { summaries: value.summaries, canEdit: value.canEdit === true, editReason: value.editReason ?? null };
}

type Props = {
  isAdmin: boolean;
  readOnly: boolean;
  timeZone: string;
  companyName: string;
  initialType: string | null;
};

/**
 * "Types and wording" (approved board 2026-11): every type grouped by who
 * receives it with its existing switch and transports (left), its details,
 * wording editor and history (middle), preview and test send (right).
 * Switches stay ADMIN only and read-only while impersonating; wording access
 * is decided by the server (ADMIN, or an operations manager with the
 * notifications pack at Manage).
 */
export function TypesTab({ isAdmin, readOnly, timeZone, companyName, initialType }: Props) {
  const catalogRead = useNotificationRead("/api/admin/notifications/catalog", parseCatalog, "Could not load notification types.");
  const summaryRead = useNotificationRead("/api/admin/notifications/wording", parseSummaries, "Could not load the wording status.");
  const [catalogOverride, setCatalogOverride] = React.useState<CatalogResponse | null>(null);
  const catalog = catalogOverride ?? catalogRead.data;
  React.useEffect(() => setCatalogOverride(null), [catalogRead.data]);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(initialType);
  const [switching, setSwitching] = React.useState(false);
  const [switchError, setSwitchError] = React.useState<string | null>(null);
  const workspaceRef = React.useRef<HTMLDivElement>(null);
  const phone = useIsPhone();
  // Phones: type list → type screen → wording editor, as stacked screens.
  const [phoneScreen, setPhoneScreen] = React.useState<"list" | WordingPhoneScreen>(initialType ? "type" : "list");

  const types = catalog?.types ?? [];
  const selected = types.find((type) => type.key === selectedKey) ?? types[0] ?? null;
  const summaries = React.useMemo(() => new Map((summaryRead.data?.summaries ?? []).map((summary) => [summary.typeKey, summary])), [summaryRead.data]);
  const canSwitch = isAdmin && !readOnly;
  const switchNote = !isAdmin ? "Only administrators can change switches." : readOnly ? "Switches are read-only while impersonating." : null;

  function select(key: string) {
    setSelectedKey(key);
    setSwitchError(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("type", key);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // The address bar is a convenience; selection works without it.
    }
    if (phone) {
      setPhoneScreen("type");
      window.scrollTo?.({ top: 0 });
      return;
    }
    if (window.matchMedia?.("(max-width: 1023px)").matches) workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function phoneTo(screen: "list" | WordingPhoneScreen) {
    setPhoneScreen(screen);
    window.scrollTo?.({ top: 0 });
  }

  async function saveSwitch(body: unknown) {
    if (switching) return;
    setSwitching(true);
    setSwitchError(null);
    const result = await sendJson("/api/admin/notifications/catalog", "PATCH", body);
    setSwitching(false);
    if (!result.ok) {
      setSwitchError(result.status === 409 ? `${result.error} The list has been reloaded.` : result.error);
      if (result.status === 409) catalogRead.reload();
      return;
    }
    setCatalogOverride(result.body as CatalogResponse);
  }

  if (catalogRead.loading && !catalog) return <p role="status">Loading notification types…</p>;
  if (!catalog) {
    return <EAlert tone="danger" title="Notification types not loaded">{catalogRead.error ?? "Could not load notification types."} <button type="button" className="underline" onClick={catalogRead.reload}>Retry</button></EAlert>;
  }

  return (
    <section aria-label="Types and wording" className="space-y-3">
      {catalogRead.error ? <EAlert tone="warning" title="Showing the last loaded list">{catalogRead.error}</EAlert> : null}
      {summaryRead.error ? <EAlert tone="warning" title="Wording status unavailable">{summaryRead.error} The list still works; edited and missing-variable counts are not shown.</EAlert> : null}
      {switchError && !selected ? <EAlert tone="danger" title="Switch not changed">{switchError}</EAlert> : null}
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start">
        {phone && phoneScreen !== "list" && selected ? (
          phoneScreen === "type" ? (
            <NotificationsPhoneBack title={selected.name} subtitle="Notification types" backLabel="Back to notification types" onBack={() => phoneTo("list")} />
          ) : null
        ) : (
          <TypeList
            types={types} summaries={summaries} controlsUpdatedAt={catalog.controlsUpdatedAt} selectedKey={selected?.key ?? null} onSelect={select}
            canSwitch={canSwitch} switching={switching} onSwitch={(body) => void saveSwitch(body)} switchNote={switchNote}
          />
        )}
        {phone && phoneScreen === "list" ? null : (
        <div ref={workspaceRef} className="flex min-w-0 flex-1 scroll-mt-4 flex-col gap-3 lg:flex-row lg:items-start">
          {selected ? (
            <WordingWorkspace
              key={selected.key}
              typeKey={selected.key}
              catalogTransports={selected.transports}
              timeZone={timeZone}
              companyName={companyName}
              testable={selected.testable === true}
              testBlockedReason={readOnly ? "Test sends are disabled while impersonating." : null}
              onSaved={summaryRead.reload}
              phoneScreen={phone && phoneScreen !== "list" ? phoneScreen : undefined}
              onPhoneScreen={phoneTo}
              details={<TypeDetails type={selected} summary={summaries.get(selected.key)} controlsUpdatedAt={catalog.controlsUpdatedAt} canSwitch={canSwitch} switchNote={switchNote} saving={switching} error={switchError} onSave={(body) => void saveSwitch(body)} timeZone={timeZone} />}
            />
          ) : <p className="text-sm">No notification types.</p>}
        </div>
        )}
      </div>
    </section>
  );
}
