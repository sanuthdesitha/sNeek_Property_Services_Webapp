"use client";
import { useEffect } from "react";

export interface ShortcutDef {
  keys: string; // e.g. "?" or "g d" (sequence) or "ctrl+s"
  label: string;
  group?: string;
  handler: (e: KeyboardEvent) => void;
}

const registry = new Map<string, ShortcutDef>();
let sequenceBuffer = "";
let sequenceTimer: ReturnType<typeof setTimeout> | null = null;

export function getRegisteredShortcuts(): ShortcutDef[] {
  return Array.from(registry.values());
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

function matchShortcut(keys: string, e: KeyboardEvent): boolean {
  if (keys.includes("+")) {
    const parts = keys.toLowerCase().split("+");
    const key = parts.pop()!;
    const needsCtrl = parts.includes("ctrl") || parts.includes("cmd");
    const needsShift = parts.includes("shift");
    return (
      e.key.toLowerCase() === key &&
      (!needsCtrl || e.ctrlKey || e.metaKey) &&
      (!needsShift || e.shiftKey)
    );
  }
  return false;
}

export function useShortcut(def: ShortcutDef) {
  useEffect(() => {
    registry.set(def.keys, def);
    return () => {
      registry.delete(def.keys);
    };
  }, [def.keys, def.label, def.handler, def.group]);
}

// Global key handler (mount once at portal root)
export function GlobalShortcutListener() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      // Single-key shortcuts
      for (const def of registry.values()) {
        if (matchShortcut(def.keys, e)) {
          def.handler(e);
          return;
        }
        if (def.keys.length === 1 && e.key === def.keys) {
          def.handler(e);
          return;
        }
      }
      // Sequence shortcuts (e.g. "g d")
      if (/^[a-z]$/i.test(e.key)) {
        sequenceBuffer += e.key.toLowerCase();
        if (sequenceTimer) clearTimeout(sequenceTimer);
        sequenceTimer = setTimeout(() => {
          sequenceBuffer = "";
        }, 600);
        for (const def of registry.values()) {
          if (def.keys.includes(" ") && def.keys.replace(/\s/g, "") === sequenceBuffer) {
            def.handler(e);
            sequenceBuffer = "";
            return;
          }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
