"use client";

/**
 * Template editor MVP (rebrand doc 03 §3) — palette · structure · live
 * preview · inspector. The preview IS the real renderer (renderEmail /
 * renderDocumentHtml / renderText) running client-side against the kind's
 * sample data: what you see is what ships.
 */

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BrandTokens } from "@/lib/brand/tokens";
import { BLOCK_REGISTRY } from "@/lib/templates/blocks/registry";
import { TEMPLATE_KINDS } from "@/lib/templates/kinds";
import { newBlockId, type Block, type BlockType, type TemplateDoc } from "@/lib/templates/model";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { renderEmail } from "@/lib/templates/render/email";
import { renderText } from "@/lib/templates/render/text";
import { BlockInspector } from "./block-inspector";
import { useEditorStore } from "./editor-store";

interface EditorProps {
  kind: string;
  definitionId: string;
  draftId: string;
  initialDoc: TemplateDoc;
  initialToken: string;
  brand: BrandTokens;
}

const AUTOSAVE_MS = 1500;

export function TemplateEditor({ kind, definitionId, draftId, initialDoc, initialToken, brand }: EditorProps) {
  const store = useEditorStore();
  const config = TEMPLATE_KINDS[kind];
  const [publishState, setPublishState] = React.useState<{
    busy: boolean;
    errors: string[];
    warnings: string[];
    publishedVersion: number | null;
  }>({ busy: false, errors: [], warnings: [], publishedVersion: null });

  React.useEffect(() => {
    store.init(initialDoc, initialToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const doc = store.doc;
  const selected = doc?.blocks.find((block) => block.id === store.selectionId) ?? null;

  // ------------------------------------------------------------------ autosave
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (!doc || store.saveStatus !== "dirty") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const state = useEditorStore.getState();
      if (!state.doc || !state.token) return;
      state.setSaveStatus("saving");
      try {
        const res = await fetch(`/api/admin/template-defs/${definitionId}/draft`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId, token: state.token, doc: state.doc }),
        });
        if (res.status === 409) {
          state.setSaveStatus("conflict");
          return;
        }
        if (!res.ok) {
          state.setSaveStatus("error");
          return;
        }
        const body = (await res.json()) as { token: string };
        state.markSaved(body.token);
      } catch {
        useEditorStore.getState().setSaveStatus("error");
      }
    }, AUTOSAVE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [doc, store.saveStatus, definitionId, draftId]);

  // ------------------------------------------------------------- keyboard undo
  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ----------------------------------------------------------------- mutations
  const appendBlock = (type: BlockType) => {
    const def = BLOCK_REGISTRY[type];
    if (!def) return;
    const block: Block = { id: newBlockId(), type, props: def.defaults() as Record<string, unknown> };
    store.apply((current) => ({ ...current, blocks: [...current.blocks, block] }));
    store.select(block.id);
  };

  const removeBlock = (blockId: string) => {
    store.apply((current) => ({ ...current, blocks: current.blocks.filter((block) => block.id !== blockId) }));
    if (store.selectionId === blockId) store.select(null);
  };

  const duplicateBlock = (blockId: string) => {
    store.apply((current) => {
      const index = current.blocks.findIndex((block) => block.id === blockId);
      if (index < 0) return current;
      const copy: Block = { ...current.blocks[index], id: newBlockId() };
      const blocks = [...current.blocks];
      blocks.splice(index + 1, 0, copy);
      return { ...current, blocks };
    });
  };

  const updateSelectedBlock = React.useCallback(
    (props: Record<string, unknown>, when: string) => {
      const state = useEditorStore.getState();
      const selectionId = state.selectionId;
      if (!selectionId) return;
      state.apply((current) => ({
        ...current,
        blocks: current.blocks.map((block) =>
          block.id === selectionId
            ? { ...block, props, when: when.trim() ? when.trim() : undefined }
            : block,
        ),
      }));
    },
    [],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    store.apply((current) => {
      const oldIndex = current.blocks.findIndex((block) => block.id === active.id);
      const newIndex = current.blocks.findIndex((block) => block.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return { ...current, blocks: arrayMove(current.blocks, oldIndex, newIndex) };
    });
  };

  // ------------------------------------------------------------------- publish
  const publish = async () => {
    setPublishState((previous) => ({ ...previous, busy: true, errors: [], warnings: [] }));
    try {
      // Flush any pending edits first so we publish what's on screen.
      const state = useEditorStore.getState();
      if (state.doc && state.token && state.saveStatus !== "saved") {
        const res = await fetch(`/api/admin/template-defs/${definitionId}/draft`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId, token: state.token, doc: state.doc }),
        });
        if (res.ok) {
          const body = (await res.json()) as { token: string };
          state.markSaved(body.token);
        }
      }
      const res = await fetch(`/api/admin/template-defs/${definitionId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const body = (await res.json()) as {
        published?: boolean;
        version?: number;
        errors?: string[];
        warnings?: string[];
      };
      setPublishState({
        busy: false,
        errors: body.errors ?? [],
        warnings: body.warnings ?? [],
        publishedVersion: body.published ? body.version ?? null : null,
      });
    } catch {
      setPublishState({ busy: false, errors: ["Publish request failed"], warnings: [], publishedVersion: null });
    }
  };

  // ------------------------------------------------------------------- preview
  const preview = React.useMemo(() => {
    if (!doc || !config) return null;
    const sample = config.sampleData();
    try {
      if (config.family === "email") {
        return { mode: "html" as const, html: renderEmail(doc, sample, brand, {}).html, width: 640 };
      }
      if (config.family === "document") {
        return { mode: "html" as const, html: renderDocumentHtml(doc, sample, brand, "web", {}), width: 794 };
      }
      const out = renderText(doc, sample, brand, {});
      return { mode: "sms" as const, text: out.text, segments: out.segments, encoding: out.encoding };
    } catch {
      return null;
    }
  }, [doc, config, brand]);

  if (!doc || !config) return <p className="p-6 text-sm text-slate-500">Loading editor…</p>;

  const statusLabel: Record<string, string> = {
    saved: "Saved",
    dirty: "Unsaved changes…",
    saving: "Saving…",
    error: "Save failed — retrying on next edit",
    conflict: "Edited elsewhere — reload the page",
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Topbar */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-slate-900">{config.label}</p>
          <p className="text-[11px] text-slate-500">
            {kind} · <span className={store.saveStatus === "conflict" || store.saveStatus === "error" ? "text-red-600" : ""}>{statusLabel[store.saveStatus]}</span>
          </p>
        </div>
        <button type="button" onClick={() => store.undo()} disabled={store.past.length === 0} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40">
          Undo
        </button>
        <button type="button" onClick={() => store.redo()} disabled={store.future.length === 0} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40">
          Redo
        </button>
        <button type="button" onClick={publish} disabled={publishState.busy} className="rounded-md bg-emerald-800 px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50">
          {publishState.busy ? "Publishing…" : "Publish"}
        </button>
      </div>

      {/* Lint / publish feedback */}
      {(publishState.errors.length > 0 || publishState.warnings.length > 0 || publishState.publishedVersion) && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[12px]">
          {publishState.publishedVersion ? (
            <p className="font-medium text-emerald-700">Published as version {publishState.publishedVersion}.</p>
          ) : null}
          {publishState.errors.map((error) => (
            <p key={error} className="text-red-600">✕ {error}</p>
          ))}
          {publishState.warnings.map((warning) => (
            <p key={warning} className="text-amber-600">⚠ {warning}</p>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        <aside className="w-40 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Blocks</p>
          <div className="space-y-1">
            {config.allowedBlocks.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => appendBlock(type)}
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-left text-[12px] font-medium text-slate-700 hover:border-emerald-600 hover:bg-emerald-50"
              >
                {BLOCK_REGISTRY[type]?.label ?? type}
              </button>
            ))}
          </div>
        </aside>

        {/* Structure (sortable) */}
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-2">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Structure</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={doc.blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {doc.blocks.map((block) => (
                  <StructureRow
                    key={block.id}
                    block={block}
                    selected={block.id === store.selectionId}
                    onSelect={() => store.select(block.id)}
                    onRemove={() => removeBlock(block.id)}
                    onDuplicate={() => duplicateBlock(block.id)}
                  />
                ))}
                {doc.blocks.length === 0 ? (
                  <p className="px-1 py-4 text-center text-[12px] text-slate-400">Add blocks from the palette.</p>
                ) : null}
              </div>
            </SortableContext>
          </DndContext>
        </aside>

        {/* Live preview — the real renderer */}
        <main className="min-w-0 flex-1 overflow-auto bg-slate-100 p-4">
          {preview?.mode === "html" ? (
            <iframe
              title="template-preview"
              sandbox=""
              srcDoc={preview.html}
              className="mx-auto block h-full min-h-[600px] rounded-lg border border-slate-300 bg-white shadow-sm"
              style={{ width: preview.width, maxWidth: "100%" }}
            />
          ) : preview?.mode === "sms" ? (
            <div className="mx-auto max-w-sm">
              <div className="rounded-2xl bg-emerald-800 px-4 py-3 text-[14px] leading-relaxed text-white shadow">
                {preview.text || <span className="opacity-60">Empty message</span>}
              </div>
              <p className="mt-2 text-center text-[12px] text-slate-500">
                {preview.segments} segment{preview.segments === 1 ? "" : "s"} · {preview.encoding.toUpperCase()}
              </p>
            </div>
          ) : (
            <p className="p-6 text-center text-sm text-red-500">Preview failed to render.</p>
          )}
        </main>

        {/* Inspector */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white">
          {selected ? (
            <BlockInspector key={selected.id} block={selected} onChange={updateSelectedBlock} />
          ) : (
            <p className="p-4 text-[13px] text-slate-400">Select a block to edit its settings.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function StructureRow({
  block,
  selected,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  block: Block;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const label = BLOCK_REGISTRY[block.type]?.label ?? block.type;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 text-[12px] ${
        selected ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${label}`}
        className="cursor-grab text-slate-400 hover:text-slate-600"
      >
        ⋮⋮
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate text-left font-medium text-slate-700">
        {label}
        {block.when ? <span className="ml-1 text-[10px] text-amber-600">if</span> : null}
      </button>
      <button type="button" onClick={onDuplicate} title="Duplicate" className="hidden text-slate-400 hover:text-slate-700 group-hover:block">
        ⧉
      </button>
      <button type="button" onClick={onRemove} title="Remove" className="hidden text-slate-400 hover:text-red-600 group-hover:block">
        ✕
      </button>
    </div>
  );
}
