"use client";

/**
 * Option lists the Jobs filters and bulk dialogs need: clients, properties,
 * active cleaners and QA-eligible inspectors (active QA inspectors plus
 * operations managers, the same rule as the job detail QA panel). Each list
 * reports whether it loaded, so an empty picker is never mistaken for "none".
 */
import { useEffect, useState } from "react";
import type { JobsClientOption, JobsPersonOption } from "./jobs-constants";

export type JobsPropertyOption = { id: string; name: string; suburb: string };
export type LoadState = "loading" | "ready" | "error";

export type JobsReferenceData = {
  clients: JobsClientOption[];
  properties: JobsPropertyOption[];
  cleaners: JobsPersonOption[];
  inspectors: JobsPersonOption[];
  state: { clients: LoadState; properties: LoadState; cleaners: LoadState; inspectors: LoadState };
};

type RawRow = Record<string, unknown>;

async function readRows(url: string, signal: AbortSignal): Promise<RawRow[]> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("Unexpected response");
  return body.filter((row): row is RawRow => Boolean(row) && typeof row === "object");
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function person(row: RawRow, suffix = ""): JobsPersonOption {
  const name = text(row.name) || text(row.email);
  return { id: text(row.id), name: suffix && name ? `${name} ${suffix}` : name, email: text(row.email) };
}

export function useJobsReferenceData(): JobsReferenceData {
  const [data, setData] = useState<JobsReferenceData>({
    clients: [], properties: [], cleaners: [], inspectors: [],
    state: { clients: "loading", properties: "loading", cleaners: "loading", inspectors: "loading" },
  });

  useEffect(() => {
    const controller = new AbortController();
    const settle = <K extends "clients" | "properties" | "cleaners" | "inspectors">(key: K, promise: Promise<JobsReferenceData[K]>) => {
      promise
        .then((rows) => {
          if (controller.signal.aborted) return;
          setData((current) => ({ ...current, [key]: rows, state: { ...current.state, [key]: "ready" } }));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setData((current) => ({ ...current, state: { ...current.state, [key]: "error" } }));
        });
    };
    settle("clients", readRows("/api/admin/clients", controller.signal)
      .then((rows) => rows.map((row) => ({ id: text(row.id), name: text(row.name) })).filter((row) => row.id)));
    settle("properties", readRows("/api/admin/properties?includeOneOff=1", controller.signal)
      .then((rows) => rows.map((row) => ({ id: text(row.id), name: text(row.name), suburb: text(row.suburb) })).filter((row) => row.id)));
    settle("cleaners", readRows("/api/admin/users?role=CLEANER", controller.signal)
      .then((rows) => rows.map((row) => person(row)).filter((row) => row.id)));
    settle("inspectors", Promise.all([
      readRows("/api/admin/users?role=QA_INSPECTOR", controller.signal),
      readRows("/api/admin/users?role=OPS_MANAGER", controller.signal),
    ]).then(([qa, ops]) => [...qa.map((row) => person(row)), ...ops.map((row) => person(row, "(Ops)"))].filter((row) => row.id)));
    return () => controller.abort();
  }, []);

  return data;
}
