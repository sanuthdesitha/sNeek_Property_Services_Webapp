"use client";

/**
 * Runs one bulk operation against POST /api/admin/form-templates/bulk, as a
 * preview (dry run) or for real, and remembers which inputs the shown preview
 * belongs to.
 *
 * - Applying is only offered for the exact operation and selection that were
 *   just previewed, so nobody saves a change they have not seen.
 * - A request is cancelled when a newer one starts or the panel unmounts, and
 *   cancellation is re-checked after parsing, so a late answer cannot show
 *   results for a different selection.
 * - After a failed apply the preview is cleared: the next step is a fresh
 *   preview of what the forms look like NOW, never a blind resend.
 */
import * as React from "react";
import type { BulkOperation, BulkResponse } from "@/lib/forms/template-bulk-types";

export type BulkRunState = {
  busy: boolean;
  error: string | null;
  preview: BulkResponse | null;
  result: BulkResponse | null;
  /** True when `preview` was made for these exact inputs. */
  previewMatches: (operation: BulkOperation) => boolean;
  run: (operation: BulkOperation, dryRun: boolean) => Promise<BulkResponse | null>;
  reset: () => void;
};

function signature(templateIds: string[], operation: BulkOperation): string {
  return JSON.stringify([[...templateIds].sort(), operation]);
}

function isBulkResponse(body: unknown): body is BulkResponse {
  return Boolean(body) && typeof body === "object" && Array.isArray((body as BulkResponse).outcomes);
}

export function useBulkRun(templateIds: string[], onApplied: () => void): BulkRunState {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{ key: string; response: BulkResponse } | null>(null);
  const [result, setResult] = React.useState<BulkResponse | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);
  const selectionKey = JSON.stringify([...templateIds].sort());

  // A different selection invalidates the preview and any earlier result.
  React.useEffect(() => {
    controllerRef.current?.abort();
    setPreview(null);
    setResult(null);
    setError(null);
    setBusy(false);
  }, [selectionKey]);

  React.useEffect(() => () => controllerRef.current?.abort(), []);

  const run = React.useCallback(
    async (operation: BulkOperation, dryRun: boolean) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setBusy(true);
      setError(null);
      if (dryRun) setResult(null);
      try {
        const response = await fetch("/api/admin/form-templates/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ templateIds, operation, dryRun }),
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return null;
        if (!response.ok || !isBulkResponse(body)) {
          const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : `The request failed (${response.status}).`;
          throw new Error(message);
        }
        if (dryRun) {
          setPreview({ key: signature(templateIds, operation), response: body });
        } else {
          setPreview(null);
          setResult(body);
          onApplied();
        }
        return body;
      } catch (cause) {
        if (controller.signal.aborted) return null;
        if (!dryRun) setPreview(null);
        setError(cause instanceof Error && cause.message ? cause.message : "The request failed.");
        return null;
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [templateIds, onApplied],
  );

  const previewMatches = React.useCallback(
    (operation: BulkOperation) => preview?.key === signature(templateIds, operation),
    [preview, templateIds],
  );

  const reset = React.useCallback(() => {
    controllerRef.current?.abort();
    setPreview(null);
    setResult(null);
    setError(null);
    setBusy(false);
  }, []);

  return { busy, error, preview: preview?.response ?? null, result, previewMatches, run, reset };
}
