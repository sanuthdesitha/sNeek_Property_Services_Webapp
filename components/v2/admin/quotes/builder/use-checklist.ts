"use client";

/**
 * "What's included": the service's base checklist (fetched per service,
 * obsolete reads ignored) and the per-quote editable override. Unchanged
 * rules: a fresh base clears per-quote edits; a stored override is applied
 * once after the base loads; an untouched checklist writes no override.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ServiceChecklist } from "@/lib/checklists/types";
import { editableFromChecklist, nextUid, type EditChecklist } from "./model";

export function useQuoteChecklist(serviceType: string, seededOverride: EditChecklist | null) {
  const [checklist, setChecklist] = useState<ServiceChecklist | null>(null);
  const [loading, setLoading] = useState(false);
  const [editChecklist, setEditChecklist] = useState<EditChecklist | null>(null);
  const [touched, setTouched] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newItemLabels, setNewItemLabels] = useState<Record<string, string>>({});
  const [newExclusion, setNewExclusion] = useState("");
  const appliedOverride = useRef(false);

  useEffect(() => {
    if (seededOverride && !appliedOverride.current && checklist) {
      appliedOverride.current = true;
      setEditChecklist(seededOverride);
      setTouched(true);
    } else {
      setEditChecklist(checklist ? editableFromChecklist(checklist) : null);
      setTouched(false);
    }
    setNewItemLabels({});
    setNewExclusion("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklist]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setChecklist(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/checklists?jobType=${encodeURIComponent(serviceType)}`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json().catch(() => ({}))) as { checklist?: ServiceChecklist | null };
        if (!controller.signal.aborted && res.ok) setChecklist(body?.checklist ?? null);
      } catch {
        // The preview is non-essential; never block the builder.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [serviceType]);

  const includedItems = useMemo(
    () => (editChecklist ? editChecklist.sections.flatMap((s) => s.items.filter((i) => i.covered).map((i) => i.label)) : []),
    [editChecklist],
  );
  const notIncludedItems = useMemo(() => {
    if (!editChecklist) return [];
    const excluded = editChecklist.sections.flatMap((s) => s.items.filter((i) => !i.covered).map((i) => i.label));
    return [...editChecklist.notCovered, ...excluded];
  }, [editChecklist]);

  function touch(next: EditChecklist) {
    setEditChecklist(next);
    setTouched(true);
  }
  function mapItems(sid: string, map: (items: EditChecklist["sections"][number]["items"]) => EditChecklist["sections"][number]["items"]) {
    if (!editChecklist) return;
    touch({ ...editChecklist, sections: editChecklist.sections.map((s) => (s.id !== sid ? s : { ...s, items: map(s.items) })) });
  }

  const ops = {
    toggleItem: (sid: string, iid: string) => mapItems(sid, (items) => items.map((it) => (it.id !== iid ? it : { ...it, covered: !it.covered }))),
    renameItem: (sid: string, iid: string, label: string) => mapItems(sid, (items) => items.map((it) => (it.id !== iid ? it : { ...it, label }))),
    removeItem: (sid: string, iid: string) => mapItems(sid, (items) => items.filter((it) => it.id !== iid)),
    addItem: (sid: string) => {
      const label = (newItemLabels[sid] ?? "").trim();
      if (!label) return;
      mapItems(sid, (items) => [...items, { id: nextUid(), label, covered: true }]);
      setNewItemLabels((prev) => ({ ...prev, [sid]: "" }));
    },
    updateSummary: (summary: string) => editChecklist && touch({ ...editChecklist, summary }),
    addExclusion: () => {
      const line = newExclusion.trim();
      if (!editChecklist || !line) return;
      touch({ ...editChecklist, notCovered: [...editChecklist.notCovered, line] });
      setNewExclusion("");
    },
    updateExclusion: (idx: number, value: string) =>
      editChecklist && touch({ ...editChecklist, notCovered: editChecklist.notCovered.map((n, i) => (i === idx ? value : n)) }),
    removeExclusion: (idx: number) => editChecklist && touch({ ...editChecklist, notCovered: editChecklist.notCovered.filter((_, i) => i !== idx) }),
    reset: () => {
      setEditChecklist(checklist ? editableFromChecklist(checklist) : null);
      setTouched(false);
      setNewItemLabels({});
      setNewExclusion("");
    },
  };

  return {
    checklist,
    loading,
    editChecklist,
    touched,
    editing,
    setEditing,
    newItemLabels,
    setNewItemLabels,
    newExclusion,
    setNewExclusion,
    includedItems,
    notIncludedItems,
    ops,
  };
}

export type QuoteChecklistState = ReturnType<typeof useQuoteChecklist>;
