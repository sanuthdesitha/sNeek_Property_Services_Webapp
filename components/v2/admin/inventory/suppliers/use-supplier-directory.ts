"use client";

/**
 * Loads the Suppliers directory (GET /api/admin/inventory/suppliers/directory).
 * An obsolete read is aborted and checked after parsing; a background reload
 * keeps the rows on screen and reports a failure as stale, never as empty.
 */
import * as React from "react";
import type { SupplierDirectoryResponse } from "@/lib/suppliers/directory-types";

export type DirectoryLoad =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready" }
  | { status: "stale"; message: string };

export function useSupplierDirectory() {
  const [data, setData] = React.useState<SupplierDirectoryResponse | null>(null);
  const [load, setLoad] = React.useState<DirectoryLoad>({ status: "loading" });
  const controllerRef = React.useRef<AbortController | null>(null);

  const reload = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoad((current) => (current.status === "ready" || current.status === "stale" ? current : { status: "loading" }));
    try {
      const response = await fetch("/api/admin/inventory/suppliers/directory", { cache: "no-store", signal: controller.signal });
      const body = (await response.json().catch(() => null)) as (SupplierDirectoryResponse & { error?: string }) | null;
      if (controller.signal.aborted) return;
      if (!response.ok || !body || !Array.isArray(body.rows)) {
        const message = body?.error ?? `Could not load suppliers (${response.status}).`;
        setLoad((current) => (current.status === "ready" || current.status === "stale" ? { status: "stale", message } : { status: "failed", message }));
        return;
      }
      setData(body);
      setLoad({ status: "ready" });
    } catch {
      if (controller.signal.aborted) return;
      const message = "Could not reach the server.";
      setLoad((current) => (current.status === "ready" || current.status === "stale" ? { status: "stale", message } : { status: "failed", message }));
    }
  }, []);

  React.useEffect(() => {
    void reload();
    return () => controllerRef.current?.abort();
  }, [reload]);

  return { data, load, reload };
}
