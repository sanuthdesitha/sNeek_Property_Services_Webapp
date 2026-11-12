"use client";

import { useCallback, useMemo, useState } from "react";
import { applyPreset, copyAccess, setPersonCapability, setPersonFullAccess, setPersonLevel } from "@/lib/rbac/access-draft";
import type { CapabilityKey } from "@/lib/rbac/capabilities";
import type { AccessLevel, OpsFeature } from "@/lib/rbac/ops-catalog";
import type { OpsPolicy } from "@/lib/rbac/ops-policy";

export type AccessDraftApi = {
  saved: OpsPolicy | null;
  draft: OpsPolicy | null;
  reset: (policy: OpsPolicy) => void;
  /** After a conflict: the newer stored policy, with this editor's changes laid over it. */
  rebase: (current: OpsPolicy, draft: OpsPolicy) => void;
  replace: (draft: OpsPolicy) => void;
  discard: () => void;
  setLevel: (userId: string, area: OpsFeature, level: AccessLevel) => void;
  setCapability: (userId: string, key: CapabilityKey, on: boolean) => void;
  setPreset: (userId: string, presetId: string) => void;
  setFullAccess: (userId: string, on: boolean) => void;
  copy: (fromId: string, toId: string) => void;
};

/** The saved policy and the editor's draft. A failed save keeps the draft. */
export function useAccessDraft(): AccessDraftApi {
  const [saved, setSaved] = useState<OpsPolicy | null>(null);
  const [draft, setDraft] = useState<OpsPolicy | null>(null);
  const edit = useCallback((change: (policy: OpsPolicy) => OpsPolicy) => setDraft((current) => (current ? change(current) : current)), []);
  const reset = useCallback((policy: OpsPolicy) => { setSaved(policy); setDraft(policy); }, []);
  return useMemo(
    () => ({
      saved,
      draft,
      reset,
      rebase: (current: OpsPolicy, next: OpsPolicy) => { setSaved(current); setDraft(next); },
      replace: (next: OpsPolicy) => setDraft(next),
      discard: () => setDraft(saved),
      setLevel: (userId, area, level) => edit((policy) => setPersonLevel(policy, userId, area, level)),
      setCapability: (userId, key, on) => edit((policy) => setPersonCapability(policy, userId, key, on)),
      setPreset: (userId, presetId) => edit((policy) => applyPreset(policy, userId, presetId)),
      setFullAccess: (userId, on) => edit((policy) => setPersonFullAccess(policy, userId, on)),
      copy: (fromId, toId) => edit((policy) => copyAccess(policy, fromId, toId)),
    }),
    [saved, draft, reset, edit],
  );
}
