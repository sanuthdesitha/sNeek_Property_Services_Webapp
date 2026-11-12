"use client";

/**
 * The builder's editable document (name, service type, schema) with a bounded
 * undo/redo history (lib/forms/builder-history.ts). Every edit goes through
 * `edit`, so undo, autosave and the preview all see the same state.
 *
 * Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo — handled by
 * the builder's own root element (`onKeyDown`), never a global listener, and
 * ignored while focus is in a text input (which keeps its native undo).
 */
import * as React from "react";
import {
  canRedo,
  canUndo,
  createHistory,
  historyShortcut,
  pushHistory,
  redo,
  resetHistory,
  undo,
  type History,
} from "@/lib/forms/builder-history";
import type { FormSchema } from "@/lib/forms/types";

export type BuilderDoc = {
  name: string;
  serviceType: string;
  schema: FormSchema;
};

type Action =
  | { type: "edit"; next: (doc: BuilderDoc) => BuilderDoc; coalesceKey?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; doc: BuilderDoc };

function reducer(history: History<BuilderDoc>, action: Action): History<BuilderDoc> {
  switch (action.type) {
    case "edit":
      return pushHistory(history, action.next(history.present), action.coalesceKey);
    case "undo":
      return undo(history);
    case "redo":
      return redo(history);
    case "reset":
      return resetHistory(history, action.doc);
  }
}

export type BuilderDocument = {
  doc: BuilderDoc;
  /** Increments on every change of `doc` (edits, undo, redo), for autosave. */
  revision: number;
  edit: (next: (doc: BuilderDoc) => BuilderDoc, coalesceKey?: string) => void;
  editSchema: (next: (schema: FormSchema) => FormSchema, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: (doc: BuilderDoc) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
};

export function useBuilderDocument(initial: BuilderDoc): BuilderDocument {
  const [history, dispatch] = React.useReducer(reducer, initial, (doc) => createHistory(doc));
  const revisionRef = React.useRef(0);
  const lastDoc = React.useRef(history.present);
  if (lastDoc.current !== history.present) {
    lastDoc.current = history.present;
    revisionRef.current += 1;
  }

  const edit = React.useCallback((next: (doc: BuilderDoc) => BuilderDoc, coalesceKey?: string) => {
    dispatch({ type: "edit", next, coalesceKey });
  }, []);
  const editSchema = React.useCallback(
    (next: (schema: FormSchema) => FormSchema, coalesceKey?: string) => {
      dispatch({ type: "edit", next: (doc) => {
        const schema = next(doc.schema);
        return schema === doc.schema ? doc : { ...doc, schema };
      }, coalesceKey });
    },
    [],
  );
  const onKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    const shortcut = historyShortcut({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      target: event.target,
    });
    if (!shortcut) return;
    event.preventDefault();
    dispatch({ type: shortcut });
  }, []);

  return {
    doc: history.present,
    revision: revisionRef.current,
    edit,
    editSchema,
    undo: React.useCallback(() => dispatch({ type: "undo" }), []),
    redo: React.useCallback(() => dispatch({ type: "redo" }), []),
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    reset: React.useCallback((doc: BuilderDoc) => dispatch({ type: "reset", doc }), []),
    onKeyDown,
  };
}
