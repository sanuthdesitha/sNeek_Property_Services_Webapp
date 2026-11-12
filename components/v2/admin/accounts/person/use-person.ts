"use client";

/**
 * Loads one person for the panel (`GET /api/admin/users/[id]`). Opening a
 * different person aborts the previous read, and an answer is applied only if
 * it is still for the person on screen after parsing, so a late response can
 * never fill another person's panel. A reload keeps the current profile on
 * screen until the fresh one arrives (stale, not blank).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PersonCapabilities, PersonProfile } from "@/lib/accounts/person-types";

export type PersonState =
  | { status: "idle" }
  | { status: "loading"; previous: PersonLoaded | null }
  | { status: "ready"; data: PersonLoaded }
  | { status: "error"; message: string; previous: PersonLoaded | null };

export type PersonLoaded = { profile: PersonProfile; capabilities: PersonCapabilities };

export async function readPerson(userId: string, signal: AbortSignal): Promise<PersonLoaded> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { cache: "no-store", signal });
  const body = (await res.json().catch(() => null)) as (PersonLoaded & { error?: string }) | null;
  if (res.status === 404) throw new Error("This account no longer exists.");
  if (!res.ok || !body?.profile) throw new Error(body?.error ?? `Could not load this account (${res.status}).`);
  return body;
}

export function usePerson(userId: string | null): { state: PersonState; reload: () => void } {
  const [state, setState] = useState<PersonState>({ status: "idle" });
  const [revision, setRevision] = useState(0);
  const current = useRef<string | null>(userId);
  current.current = userId;
  const lastLoaded = useRef<PersonLoaded | null>(null);

  useEffect(() => {
    if (!userId) {
      lastLoaded.current = null;
      setState({ status: "idle" });
      return;
    }
    // Only keep the previous profile visible while reloading the SAME person.
    const previous = lastLoaded.current?.profile.id === userId ? lastLoaded.current : null;
    const controller = new AbortController();
    setState({ status: "loading", previous });
    readPerson(userId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted || current.current !== userId || data.profile.id !== userId) return;
        lastLoaded.current = data;
        setState({ status: "ready", data });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || current.current !== userId) return;
        setState({ status: "error", message: reason instanceof Error ? reason.message : "Could not load this account.", previous });
      });
    return () => controller.abort();
  }, [userId, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { state, reload };
}

export function loadedOf(state: PersonState): PersonLoaded | null {
  if (state.status === "ready") return state.data;
  if (state.status === "loading" || state.status === "error") return state.previous;
  return null;
}
