"use client";

/**
 * Reads the property (GET /api/admin/properties/:id) and saves sections
 * (PATCH with only that section's keys). A read for an older property id is
 * aborted and checked after parsing, so it never fills a different property.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PropertyPatch, PropertyRecord } from "./property-record";

export type RecordState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed"; message: string }
  | { status: "ready"; property: PropertyRecord };

export type SaveResult = { ok: true } | { ok: false; error: string };

export function usePropertyRecord(propertyId: string) {
  const [state, setState] = useState<RecordState>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const current = useRef(propertyId);

  useEffect(() => {
    current.current = propertyId;
    const controller = new AbortController();
    fetch(`/api/admin/properties/${encodeURIComponent(propertyId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (PropertyRecord & { error?: string }) | null;
        if (controller.signal.aborted || current.current !== propertyId) return;
        if (response.status === 404 || (response.ok && (!body || body.error))) {
          setState({ status: "missing" });
          return;
        }
        if (!response.ok || !body) {
          setState((previous) => (previous.status === "ready" ? previous : { status: "failed", message: body?.error ?? `Could not load the property (${response.status}).` }));
          return;
        }
        setState({ status: "ready", property: { ...body, propertyStock: Array.isArray(body.propertyStock) ? body.propertyStock : [] } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || current.current !== propertyId) return;
        setState((previous) => (previous.status === "ready" ? previous : { status: "failed", message: error instanceof Error ? error.message : "Could not load the property." }));
      });
    return () => controller.abort();
  }, [propertyId, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  const save = useCallback(
    async (patch: PropertyPatch): Promise<SaveResult> => {
      try {
        const response = await fetch(`/api/admin/properties/${encodeURIComponent(propertyId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return { ok: false, error: body.error ?? "Could not update property." };
        reload();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Could not update property." };
      }
    },
    [propertyId, reload],
  );

  return { state, reload, save };
}
