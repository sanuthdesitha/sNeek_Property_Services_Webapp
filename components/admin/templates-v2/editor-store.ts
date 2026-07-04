"use client";

/**
 * Template editor state (rebrand doc 03 §3.2) — zustand with a manual
 * temporal slice (past/future) for undo/redo. History records document
 * mutations, not selection changes.
 */

import { create } from "zustand";
import type { TemplateDoc } from "@/lib/templates/model";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

interface EditorState {
  doc: TemplateDoc | null;
  selectionId: string | null;
  past: TemplateDoc[];
  future: TemplateDoc[];
  saveStatus: SaveStatus;
  token: string | null;

  init(doc: TemplateDoc, token: string): void;
  /** Apply a doc mutation, pushing the previous doc onto the undo stack. */
  apply(mutate: (doc: TemplateDoc) => TemplateDoc): void;
  select(blockId: string | null): void;
  undo(): void;
  redo(): void;
  setSaveStatus(status: SaveStatus): void;
  markSaved(token: string): void;
}

const HISTORY_LIMIT = 50;

export const useEditorStore = create<EditorState>((set, get) => ({
  doc: null,
  selectionId: null,
  past: [],
  future: [],
  saveStatus: "saved",
  token: null,

  init(doc, token) {
    set({ doc, token, past: [], future: [], selectionId: null, saveStatus: "saved" });
  },

  apply(mutate) {
    const { doc, past } = get();
    if (!doc) return;
    const next = mutate(doc);
    if (next === doc) return;
    set({
      doc: next,
      past: [...past.slice(-HISTORY_LIMIT + 1), doc],
      future: [],
      saveStatus: "dirty",
    });
  },

  select(blockId) {
    set({ selectionId: blockId });
  },

  undo() {
    const { doc, past, future } = get();
    if (!doc || past.length === 0) return;
    const previous = past[past.length - 1];
    set({ doc: previous, past: past.slice(0, -1), future: [doc, ...future], saveStatus: "dirty" });
  },

  redo() {
    const { doc, past, future } = get();
    if (!doc || future.length === 0) return;
    const [next, ...rest] = future;
    set({ doc: next, past: [...past, doc], future: rest, saveStatus: "dirty" });
  },

  setSaveStatus(status) {
    set({ saveStatus: status });
  },

  markSaved(token) {
    // Only flip to saved if nothing changed while the PATCH was in flight.
    set((state) => ({ token, saveStatus: state.saveStatus === "saving" ? "saved" : state.saveStatus }));
  },
}));
