"use client";

/**
 * The open case: the full conversation (GET /api/admin/cases/[id]) and the
 * read-only linked facts (GET /api/admin/cases/[id]/linked), loaded when a case
 * is opened. When the selection changes, the previous reads are aborted and a
 * response is checked against the current id after parsing, so a late answer
 * never fills another case.
 */
import * as React from "react";
import type { CaseLinkedContext } from "@/lib/cases/linked-context";
import { readJson, type CaseDetail } from "./case-types";

export type CaseDetailStatus = "idle" | "loading" | "success" | "error";

export type CaseDetailData = {
  detail: CaseDetail | null;
  linked: CaseLinkedContext | null;
  linkedStatus: CaseDetailStatus;
  status: CaseDetailStatus;
  error: string;
  /** Put a case returned by a mutation in place, if it is still the open one. */
  accept: (detail: CaseDetail) => void;
  reload: () => void;
  /**
   * Re-read the open case in the background (manual Refresh, after a next
   * step): the current case stays on screen, an obsolete refresh is aborted
   * and a late answer for another case is ignored.
   */
  refresh: () => void;
};

export function useCaseDetail(caseId: string | null): CaseDetailData {
  const [detail, setDetail] = React.useState<CaseDetail | null>(null);
  const [linked, setLinked] = React.useState<CaseLinkedContext | null>(null);
  const [status, setStatus] = React.useState<CaseDetailStatus>("idle");
  const [linkedStatus, setLinkedStatus] = React.useState<CaseDetailStatus>("idle");
  const [error, setError] = React.useState("");
  const [nonce, setNonce] = React.useState(0);
  const currentId = React.useRef(caseId);
  currentId.current = caseId;

  React.useEffect(() => {
    setDetail(null);
    setLinked(null);
    setError("");
    if (!caseId) {
      setStatus("idle");
      setLinkedStatus("idle");
      return;
    }
    const controller = new AbortController();
    const stale = () => controller.signal.aborted || currentId.current !== caseId;
    setStatus("loading");
    setLinkedStatus("loading");

    void (async () => {
      try {
        const response = await fetch(`/api/admin/cases/${encodeURIComponent(caseId)}`, { cache: "no-store", signal: controller.signal });
        const body = await readJson<CaseDetail>(response);
        if (stale()) return;
        if (!response.ok || body.id !== caseId) throw new Error(body.error || "Could not load this case.");
        setDetail(body);
        setStatus("success");
      } catch (cause) {
        if (stale()) return;
        setError(cause instanceof Error ? cause.message : "Could not load this case.");
        setStatus("error");
      }
    })();

    void (async () => {
      try {
        const response = await fetch(`/api/admin/cases/${encodeURIComponent(caseId)}/linked`, { cache: "no-store", signal: controller.signal });
        const body = await readJson<CaseLinkedContext>(response);
        if (stale()) return;
        if (!response.ok) throw new Error(body.error || "Could not load linked details.");
        setLinked(body);
        setLinkedStatus("success");
      } catch {
        if (stale()) return;
        setLinkedStatus("error");
      }
    })();

    return () => controller.abort();
  }, [caseId, nonce]);

  const accept = React.useCallback((next: CaseDetail) => {
    if (next.id === currentId.current) setDetail(next);
  }, []);

  const refreshController = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => refreshController.current?.abort(), [caseId]);
  const refresh = React.useCallback(() => {
    const id = currentId.current;
    if (!id) return;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const stale = () => controller.signal.aborted || currentId.current !== id;
    void (async () => {
      try {
        const [caseResponse, linkedResponse] = await Promise.all([
          fetch(`/api/admin/cases/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal }),
          fetch(`/api/admin/cases/${encodeURIComponent(id)}/linked`, { cache: "no-store", signal: controller.signal }),
        ]);
        const [caseBody, linkedBody] = await Promise.all([readJson<CaseDetail>(caseResponse), readJson<CaseLinkedContext>(linkedResponse)]);
        if (stale()) return;
        if (caseResponse.ok && caseBody.id === id) {
          setDetail(caseBody);
          setStatus("success");
        }
        if (linkedResponse.ok) {
          setLinked(linkedBody);
          setLinkedStatus("success");
        }
      } catch {
        // A failed background refresh keeps what is on screen; the list says when it could not refresh.
      }
    })();
  }, []);

  return { detail, linked, linkedStatus, status, error, accept, reload: () => setNonce((n) => n + 1), refresh };
}
