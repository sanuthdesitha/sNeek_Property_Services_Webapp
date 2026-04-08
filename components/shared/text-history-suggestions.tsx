"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

const MAX_SUGGESTIONS = 5;
const MAX_VALUE_LENGTH = 120;
const STORAGE_PREFIX = "text-history-v1";

type SuggestionStore = Record<string, string[]>;

type EligibleField = HTMLInputElement | HTMLTextAreaElement;

function isEligibleInputType(type: string) {
  const normalized = (type || "text").toLowerCase();
  return ["text", "search", "email", "tel", "url"].includes(normalized);
}

function isEligibleField(target: EventTarget | null): target is EligibleField {
  if (!target) return false;
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly;
  if (!(target instanceof HTMLInputElement)) return false;
  if (!isEligibleInputType(target.type)) return false;
  return !target.disabled && !target.readOnly;
}

function normalizeValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function setFieldValue(field: EligibleField, value: string) {
  if (field instanceof HTMLTextAreaElement) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    if (descriptor?.set) descriptor.set.call(field, value);
    else field.value = value;
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  if (descriptor?.set) descriptor.set.call(field, value);
  else field.value = value;
}

function buildFieldIdentity(pathname: string, field: EligibleField) {
  const explicitKey = field.getAttribute("data-history-key");
  if (explicitKey && explicitKey.trim()) {
    return `${pathname}|${explicitKey.trim().toLowerCase()}`;
  }

  const fieldName =
    field.name ||
    field.id ||
    field.getAttribute("aria-label") ||
    field.getAttribute("placeholder");
  if (!fieldName || !fieldName.trim()) return null;
  const formName = field.form?.id || field.form?.getAttribute("name") || "";
  return `${pathname}|${formName.toLowerCase()}|${fieldName.trim().toLowerCase()}`;
}

function readStore(storageKey: string): SuggestionStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(storageKey: string, value: SuggestionStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore localStorage quota/privacy mode failures.
  }
}

const PUBLIC_PATH_PREFIXES = [
  "/airbnb-hosting",
  "/blog",
  "/careers",
  "/cleaning",
  "/compare",
  "/contact",
  "/faq",
  "/feedback",
  "/privacy",
  "/quote",
  "/services",
  "/subscriptions",
  "/terms",
  "/why-us",
];

export function TextHistorySuggestions() {
  const pathname = usePathname() ?? "";
  const { data: session } = useSession();

  const isPublicPath = PUBLIC_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  const activeFieldRef = useRef<EligibleField | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelInteractionRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 320,
  });

  const storageKey = useMemo(() => {
    const scopedUser = (session?.user as { id?: string; email?: string } | undefined)?.id
      || session?.user?.email
      || "anonymous";
    return `${STORAGE_PREFIX}:${scopedUser}`;
  }, [session?.user]);

  function updatePanelPosition() {
    const field = activeFieldRef.current;
    if (!field) return;
    const rect = field.getBoundingClientRect();
    const width = Math.max(220, Math.min(rect.width, window.innerWidth - 16));
    const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
    const top = rect.bottom + 6;
    setPanelStyle({ top, left, width });
  }

  function saveFieldValue(field: EligibleField) {
    if (field.getAttribute("data-history-disabled") === "true") return;
    const identity = buildFieldIdentity(pathname, field);
    if (!identity) return;
    const value = normalizeValue(field.value || "");
    if (!value) return;
    if (value.length > MAX_VALUE_LENGTH) return;

    const store = readStore(storageKey);
    const existing = Array.isArray(store[identity]) ? store[identity] : [];
    const merged = [value, ...existing.filter((row) => row !== value)].slice(0, MAX_SUGGESTIONS);
    store[identity] = merged;
    writeStore(storageKey, store);

    if (activeFieldRef.current === field) {
      setSuggestions(merged);
      setVisible(merged.length > 0);
      updatePanelPosition();
    }
  }

  function loadSuggestions(field: EligibleField) {
    if (field.getAttribute("data-history-disabled") === "true") {
      setSuggestions([]);
      setVisible(false);
      return;
    }
    const identity = buildFieldIdentity(pathname, field);
    if (!identity) {
      setSuggestions([]);
      setVisible(false);
      return;
    }
    const store = readStore(storageKey);
    const items = Array.isArray(store[identity]) ? store[identity].slice(0, MAX_SUGGESTIONS) : [];
    setSuggestions(items);
    setVisible(items.length > 0);
    updatePanelPosition();
  }

  function applySuggestion(value: string) {
    const field = activeFieldRef.current;
    if (!field) return;
    field.focus();
    setFieldValue(field, value);
    try {
      field.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText" }));
    } catch {
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    field.dispatchEvent(new Event("change", { bubbles: true }));
    if (typeof field.setSelectionRange === "function") {
      const caret = value.length;
      field.setSelectionRange(caret, caret);
    }
    saveFieldValue(field);
    setVisible(false);
  }

  function markPanelInteraction() {
    panelInteractionRef.current = true;
    window.setTimeout(() => {
      panelInteractionRef.current = false;
    }, 0);
  }

  useEffect(() => {
    setVisible(false);
    setSuggestions([]);
    activeFieldRef.current = null;
  }, [pathname]);

  useEffect(() => {
    function onFocusIn(event: FocusEvent) {
      if (!isEligibleField(event.target)) {
        activeFieldRef.current = null;
        setVisible(false);
        return;
      }
      activeFieldRef.current = event.target;
      loadSuggestions(event.target);
    }

    function onFocusOut(event: FocusEvent) {
      if (isEligibleField(event.target)) {
        saveFieldValue(event.target);
      }
      if (panelInteractionRef.current) return;
      const next = event.relatedTarget;
      const insidePanel = next instanceof Node && panelRef.current?.contains(next);
      if (!insidePanel) {
        setVisible(false);
      }
    }

    function onSubmit(event: Event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const fields = Array.from(form.elements).filter((el): el is EligibleField => isEligibleField(el));
      for (const field of fields) {
        saveFieldValue(field);
      }
    }

    function onWindowMove() {
      if (!activeFieldRef.current || !visible) return;
      updatePanelPosition();
    }

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("resize", onWindowMove);
    window.addEventListener("scroll", onWindowMove, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("resize", onWindowMove);
      window.removeEventListener("scroll", onWindowMove, true);
    };
  }, [pathname, storageKey, visible]);

  if (isPublicPath || !visible || suggestions.length === 0) return null;

  return (
    <div
      ref={panelRef}
      data-text-history-suggestions="true"
      className="pointer-events-auto fixed z-[95] rounded-lg border border-border bg-background/95 p-1.5 shadow-xl backdrop-blur"
      style={{ top: panelStyle.top, left: panelStyle.left, width: panelStyle.width }}
      onMouseDownCapture={(event) => {
        markPanelInteraction();
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Recent suggestions
      </div>
      <div className="flex flex-wrap gap-1">
        {suggestions.map((item, idx) => (
          <button
            key={`${item}-${idx}`}
            type="button"
            className="max-w-full truncate rounded-full border border-border px-2 py-1 text-xs hover:bg-muted"
            title={item}
            onPointerDown={(event) => {
              markPanelInteraction();
              event.preventDefault();
              event.stopPropagation();
              applySuggestion(item);
            }}
            onMouseDown={(event) => {
              markPanelInteraction();
              event.preventDefault();
              event.stopPropagation();
              applySuggestion(item);
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
