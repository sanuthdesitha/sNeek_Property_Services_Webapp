"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  ImageIcon,
  Layers,
  ListChecks,
  Palette,
  Camera as CameraIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { getFieldTypeDef, isUploadFieldType } from "@/lib/forms/field-types";
import type { FormField, FormFieldType, FormSchema } from "@/lib/forms/types";
import { DIVIDER_LABEL } from "./form-blocks";
import { BuilderCanvas } from "./builder-canvas";
import { FieldPalette, PALETTE_DRAG_PREFIX } from "./field-palette";
import { PropertiesPanel } from "./properties-panel";
import { ThemeEditor } from "./theme-editor";
import { FieldIcon } from "./field-icon";

export interface FormBuilderProps {
  templateId: string;
  initialName: string;
  initialKind: string;
  initialVersion: number;
  initialSchema: FormSchema;
  initialIsActive: boolean;
  initialArchived: boolean;
}

type Action =
  | { type: "SET_NAME"; name: string }
  | { type: "ADD_SECTION" }
  | { type: "DUPLICATE_SECTION"; sectionId: string }
  | { type: "REMOVE_SECTION"; sectionId: string }
  | { type: "UPDATE_SECTION_TITLE"; sectionId: string; title: string }
  | { type: "UPDATE_SECTION_DESCRIPTION"; sectionId: string; description: string }
  | { type: "REORDER_SECTIONS"; from: number; to: number }
  | { type: "ADD_FIELD"; sectionId: string; field: FormField; index?: number }
  | { type: "UPDATE_FIELD"; sectionId: string; field: FormField }
  | { type: "REMOVE_FIELD"; sectionId: string; fieldId: string }
  | { type: "DUPLICATE_FIELD"; sectionId: string; fieldId: string }
  | { type: "REORDER_FIELDS"; sectionId: string; from: number; to: number }
  | { type: "MOVE_FIELD"; fromSectionId: string; toSectionId: string; fieldId: string; toIndex: number }
  | { type: "SET_THEME"; theme: FormSchema["theme"] }
  | { type: "MARK_CLEAN" };

interface State {
  name: string;
  schema: FormSchema;
  dirty: boolean;
}

function newFieldId() {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Deep-copies a field (incl. sub-fields) with fresh ids. */
function duplicateField(field: FormField): FormField {
  return {
    ...JSON.parse(JSON.stringify(field)),
    id: newFieldId(),
    label: `${field.label} (copy)`,
    children: field.children?.map((child) => ({
      ...JSON.parse(JSON.stringify(child)),
      id: newFieldId(),
    })),
  };
}

function mapSection(state: State, sectionId: string, fn: (s: FormSchema["sections"][number]) => FormSchema["sections"][number]): State {
  return {
    ...state,
    dirty: true,
    schema: { ...state.schema, sections: state.schema.sections.map((s) => (s.id === sectionId ? fn(s) : s)) },
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_NAME":
      return { ...state, name: action.name, dirty: true };
    case "ADD_SECTION":
      return {
        ...state,
        dirty: true,
        schema: {
          ...state.schema,
          sections: [...state.schema.sections, { id: `s-${Date.now()}`, title: "New section", fields: [] }],
        },
      };
    case "DUPLICATE_SECTION": {
      const index = state.schema.sections.findIndex((s) => s.id === action.sectionId);
      if (index === -1) return state;
      const src = state.schema.sections[index];
      const copy = {
        ...JSON.parse(JSON.stringify(src)),
        id: `s-${Date.now()}`,
        title: `${src.title} (copy)`,
        fields: src.fields.map((f) => duplicateField(f)),
      };
      const sections = [...state.schema.sections];
      sections.splice(index + 1, 0, copy);
      return { ...state, dirty: true, schema: { ...state.schema, sections } };
    }
    case "REMOVE_SECTION":
      return {
        ...state,
        dirty: true,
        schema: { ...state.schema, sections: state.schema.sections.filter((s) => s.id !== action.sectionId) },
      };
    case "UPDATE_SECTION_TITLE":
      return mapSection(state, action.sectionId, (s) => ({ ...s, title: action.title }));
    case "UPDATE_SECTION_DESCRIPTION":
      return mapSection(state, action.sectionId, (s) => ({ ...s, description: action.description || undefined }));
    case "REORDER_SECTIONS":
      return {
        ...state,
        dirty: true,
        schema: { ...state.schema, sections: arrayMove(state.schema.sections, action.from, action.to) },
      };
    case "ADD_FIELD":
      return mapSection(state, action.sectionId, (s) => {
        const fields = [...s.fields];
        const at = action.index ?? fields.length;
        fields.splice(at, 0, action.field);
        return { ...s, fields };
      });
    case "UPDATE_FIELD":
      return mapSection(state, action.sectionId, (s) => ({
        ...s,
        fields: s.fields.map((f) => (f.id === action.field.id ? action.field : f)),
      }));
    case "REMOVE_FIELD":
      return mapSection(state, action.sectionId, (s) => ({
        ...s,
        fields: s.fields.filter((f) => f.id !== action.fieldId),
      }));
    case "DUPLICATE_FIELD":
      return mapSection(state, action.sectionId, (s) => {
        const index = s.fields.findIndex((f) => f.id === action.fieldId);
        if (index === -1) return s;
        const fields = [...s.fields];
        fields.splice(index + 1, 0, duplicateField(s.fields[index]));
        return { ...s, fields };
      });
    case "REORDER_FIELDS":
      return mapSection(state, action.sectionId, (s) => ({
        ...s,
        fields: arrayMove(s.fields, action.from, action.to),
      }));
    case "MOVE_FIELD": {
      const { fromSectionId, toSectionId, fieldId, toIndex } = action;
      const from = state.schema.sections.find((s) => s.id === fromSectionId);
      const field = from?.fields.find((f) => f.id === fieldId);
      if (!field) return state;
      return {
        ...state,
        dirty: true,
        schema: {
          ...state.schema,
          sections: state.schema.sections.map((s) => {
            if (s.id === fromSectionId) return { ...s, fields: s.fields.filter((f) => f.id !== fieldId) };
            if (s.id === toSectionId) {
              const fields = [...s.fields];
              const at = Math.min(Math.max(0, toIndex), fields.length);
              fields.splice(at, 0, field);
              return { ...s, fields };
            }
            return s;
          }),
        },
      };
    }
    case "SET_THEME":
      return { ...state, dirty: true, schema: { ...state.schema, theme: action.theme } };
    case "MARK_CLEAN":
      return { ...state, dirty: false };
  }
}

export function FormBuilder({
  templateId,
  initialName,
  initialKind,
  initialVersion,
  initialSchema,
  initialIsActive,
  initialArchived,
}: FormBuilderProps) {
  const [state, dispatch] = React.useReducer(reducer, {
    name: initialName,
    schema: initialSchema,
    dirty: false,
  });
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isActive, setIsActive] = React.useState(initialIsActive);
  const [archived, setArchived] = React.useState(initialArchived);
  const [selectedFieldId, setSelectedFieldId] = React.useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(new Set());
  const [activeDrag, setActiveDrag] = React.useState<{ kind: "field" | "section" | "palette"; label: string; icon?: string } | null>(null);
  const router = useRouter();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ---- selected field lookup ----
  const selected = React.useMemo(() => {
    if (!selectedFieldId) return null;
    for (const section of state.schema.sections) {
      const field = section.fields.find((f) => f.id === selectedFieldId);
      if (field) return { section, field };
    }
    return null;
  }, [selectedFieldId, state.schema.sections]);

  // ---- stats ----
  const flatFields = state.schema.sections.flatMap((s) => s.fields.flatMap((f) => [f, ...(f.children ?? [])]));
  const totalFields = flatFields.length;
  const requiredPhotoCount = flatFields.reduce((sum, f) => {
    if (!isUploadFieldType(f.type)) return sum;
    if (f.required) return sum + Math.max(1, f.minPhotos ?? 1);
    return sum + (f.minPhotos ?? 0);
  }, 0);
  const allFields = flatFields.map((f) => ({ id: f.id, label: f.label }));

  // ---- save / publish / duplicate (contracts unchanged) ----
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/form-templates/${templateId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: state.name, schema: state.schema }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      setSavedAt(new Date());
      dispatch({ type: "MARK_CLEAN" });
    } catch (err: any) {
      setError(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    setError(null);
    const action = isActive ? "archive" : "publish";
    try {
      const res = await fetch(`/api/admin/form-templates/${templateId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Action failed (${res.status})`);
      }
      const { template } = await res.json();
      setIsActive(Boolean(template?.isActive));
      setArchived(Boolean(template?.archivedAt));
    } catch (err: any) {
      setError(err?.message ?? "Publish failed");
    }
  }

  async function duplicate() {
    setError(null);
    try {
      const res = await fetch(`/api/admin/form-templates/${templateId}/duplicate`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Duplicate failed (${res.status})`);
      }
      const { template } = await res.json();
      router.push(`/admin/forms/${template.id}/edit`);
    } catch (err: any) {
      setError(err?.message ?? "Duplicate failed");
    }
  }

  // ---- add helpers ----
  function makeField(type: FormFieldType): FormField {
    return {
      id: newFieldId(),
      type,
      label: `New ${getFieldTypeDef(type)?.label ?? type} field`,
      ...(getFieldTypeDef(type)?.defaultConfig ?? {}),
    };
  }

  function addFieldToSection(sectionId: string, type: FormFieldType = "text") {
    const field = makeField(type);
    dispatch({ type: "ADD_FIELD", sectionId, field });
    setSelectedFieldId(field.id);
  }

  function quickAdd(type: FormFieldType) {
    const target = selected?.section.id ?? state.schema.sections[0]?.id;
    if (!target) {
      dispatch({ type: "ADD_SECTION" });
      return;
    }
    addFieldToSection(target, type);
  }

  function addBlock(kind: "heading" | "divider") {
    const target = selected?.section.id ?? state.schema.sections[0]?.id;
    if (!target) return;
    const field: FormField =
      kind === "heading"
        ? { id: newFieldId(), type: "instruction", label: "Section heading", helpText: "Add a short instruction or note here." }
        : { id: newFieldId(), type: "instruction", label: DIVIDER_LABEL };
    dispatch({ type: "ADD_FIELD", sectionId: target, field });
    setSelectedFieldId(field.id);
  }

  function toggleSection(sectionId: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function sectionOf(fieldId: string) {
    return state.schema.sections.find((s) => s.fields.some((f) => f.id === fieldId));
  }

  // ---- DnD ----
  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    if (id.startsWith(PALETTE_DRAG_PREFIX)) {
      const type = id.slice(PALETTE_DRAG_PREFIX.length) as FormFieldType;
      setActiveDrag({ kind: "palette", label: getFieldTypeDef(type)?.label ?? type, icon: getFieldTypeDef(type)?.icon });
      return;
    }
    const section = state.schema.sections.find((s) => s.id === id);
    if (section) {
      setActiveDrag({ kind: "section", label: section.title || "Section" });
      return;
    }
    const owner = sectionOf(id);
    const field = owner?.fields.find((f) => f.id === id);
    if (field) setActiveDrag({ kind: "field", label: field.label || "Field", icon: getFieldTypeDef(field.type)?.icon });
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // 1) Palette drop → insert new field.
    if (activeId.startsWith(PALETTE_DRAG_PREFIX)) {
      const type = activeId.slice(PALETTE_DRAG_PREFIX.length) as FormFieldType;
      const field = makeField(type);
      // Dropped on a section drop-zone (empty area).
      if (overId.startsWith("section-drop:")) {
        dispatch({ type: "ADD_FIELD", sectionId: overId.slice("section-drop:".length), field });
        setSelectedFieldId(field.id);
        return;
      }
      // Dropped over an existing field → insert just before it.
      const overOwner = sectionOf(overId);
      if (overOwner) {
        const index = overOwner.fields.findIndex((f) => f.id === overId);
        dispatch({ type: "ADD_FIELD", sectionId: overOwner.id, field, index: index < 0 ? undefined : index });
        setSelectedFieldId(field.id);
        return;
      }
      // Dropped over a section header/body.
      const overSection = state.schema.sections.find((s) => s.id === overId);
      if (overSection) {
        dispatch({ type: "ADD_FIELD", sectionId: overSection.id, field });
        setSelectedFieldId(field.id);
      }
      return;
    }

    // 2) Section reorder.
    const fromSectionIndex = state.schema.sections.findIndex((s) => s.id === activeId);
    if (fromSectionIndex !== -1) {
      const toSectionIndex = state.schema.sections.findIndex((s) => s.id === overId);
      if (toSectionIndex !== -1 && fromSectionIndex !== toSectionIndex) {
        dispatch({ type: "REORDER_SECTIONS", from: fromSectionIndex, to: toSectionIndex });
      }
      return;
    }

    // 3) Field move / reorder.
    const fromSection = sectionOf(activeId);
    if (!fromSection) return;

    // Dropped on a section drop-zone (append to that section).
    if (overId.startsWith("section-drop:")) {
      const toSectionId = overId.slice("section-drop:".length);
      if (toSectionId === fromSection.id) return;
      const toSection = state.schema.sections.find((s) => s.id === toSectionId);
      dispatch({ type: "MOVE_FIELD", fromSectionId: fromSection.id, toSectionId, fieldId: activeId, toIndex: toSection?.fields.length ?? 0 });
      return;
    }

    const toSection = sectionOf(overId);
    if (!toSection) return;
    if (toSection.id === fromSection.id) {
      const from = fromSection.fields.findIndex((f) => f.id === activeId);
      const to = fromSection.fields.findIndex((f) => f.id === overId);
      if (from !== -1 && to !== -1 && from !== to) {
        dispatch({ type: "REORDER_FIELDS", sectionId: fromSection.id, from, to });
      }
    } else {
      const toIndex = toSection.fields.findIndex((f) => f.id === overId);
      dispatch({
        type: "MOVE_FIELD",
        fromSectionId: fromSection.id,
        toSectionId: toSection.id,
        fieldId: activeId,
        toIndex: toIndex < 0 ? toSection.fields.length : toIndex,
      });
    }
  }

  return (
    <div className="flex h-[calc(100vh-1px)] flex-col">
      {/* ---- Top bar ---- */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Input
            value={state.name}
            onChange={(e) => dispatch({ type: "SET_NAME", name: e.target.value })}
            className="max-w-sm text-lg font-semibold"
            aria-label="Template name"
          />
          <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
            <span className="inline-flex items-center gap-1">
              <Layers className="size-3.5" /> {state.schema.sections.length} sections
            </span>
            <span className="inline-flex items-center gap-1">
              <ListChecks className="size-3.5" /> {totalFields} fields
            </span>
            <span className="inline-flex items-center gap-1">
              <CameraIcon className="size-3.5" /> {requiredPhotoCount} req. photos
            </span>
            <span className="tabular-nums">
              {initialKind} · v{initialVersion}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {savedAt && !state.dirty && (
            <span className="text-xs text-muted-foreground">Saved {savedAt.toLocaleTimeString()}</span>
          )}
          {state.dirty ? (
            <StatusPill variant="warning" withDot>
              Unsaved changes
            </StatusPill>
          ) : (
            <StatusPill variant="success">All changes saved</StatusPill>
          )}
          {archived ? (
            <StatusPill variant="neutral">Archived</StatusPill>
          ) : isActive ? (
            <StatusPill variant="success">Published</StatusPill>
          ) : (
            <StatusPill variant="warning">Draft</StatusPill>
          )}

          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="outline" size="sm">
                <Palette className="mr-1 size-4" /> Theme
              </Button>
            </DrawerTrigger>
            <DrawerContent side="right">
              <DrawerHeader>
                <DrawerTitle>Form appearance</DrawerTitle>
              </DrawerHeader>
              <div className="overflow-y-auto px-4 pb-10">
                <ThemeEditor theme={state.schema.theme} onChange={(theme) => dispatch({ type: "SET_THEME", theme })} />
              </div>
            </DrawerContent>
          </Drawer>

          <Button variant="outline" size="sm" onClick={duplicate}>
            Duplicate
          </Button>
          <Button variant="outline" size="sm" onClick={togglePublish}>
            {isActive ? "Archive" : "Publish"}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !state.dirty}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {error && (
        <p className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</p>
      )}

      {/* ---- 3-pane builder ---- */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
          {/* Palette */}
          <aside className="hidden border-r border-border bg-surface lg:block">
            <FieldPalette onAdd={quickAdd} onAddBlock={addBlock} />
          </aside>

          {/* Canvas */}
          <main
            className="min-h-0 overflow-y-auto bg-muted/20 p-4 md:p-8"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedFieldId(null);
            }}
          >
            <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Live preview — exactly what the cleaner sees
            </p>
            <BuilderCanvas
              schema={state.schema}
              selectedFieldId={selectedFieldId}
              collapsedSections={collapsedSections}
              onSelectField={setSelectedFieldId}
              onToggleSection={toggleSection}
              onUpdateSectionTitle={(sectionId, title) => dispatch({ type: "UPDATE_SECTION_TITLE", sectionId, title })}
              onUpdateSectionDescription={(sectionId, description) =>
                dispatch({ type: "UPDATE_SECTION_DESCRIPTION", sectionId, description })
              }
              onAddSection={() => dispatch({ type: "ADD_SECTION" })}
              onRemoveSection={(sectionId) => {
                dispatch({ type: "REMOVE_SECTION", sectionId });
                if (selected?.section.id === sectionId) setSelectedFieldId(null);
              }}
              onDuplicateSection={(sectionId) => dispatch({ type: "DUPLICATE_SECTION", sectionId })}
              onAddFieldToSection={(sectionId) => addFieldToSection(sectionId)}
              onRemoveField={(sectionId, fieldId) => {
                dispatch({ type: "REMOVE_FIELD", sectionId, fieldId });
                if (selectedFieldId === fieldId) setSelectedFieldId(null);
              }}
              onDuplicateField={(sectionId, fieldId) => dispatch({ type: "DUPLICATE_FIELD", sectionId, fieldId })}
              onUpdateField={(sectionId, field) => dispatch({ type: "UPDATE_FIELD", sectionId, field })}
              onInsertField={(sectionId, type, index) => {
                const field = makeField(type);
                dispatch({ type: "ADD_FIELD", sectionId, field, index });
                setSelectedFieldId(field.id);
              }}
            />
          </main>

          {/* Properties */}
          <aside className="hidden border-l border-border bg-surface lg:block">
            {selected ? (
              <PropertiesPanel
                key={selected.field.id}
                field={selected.field}
                onUpdate={(field) => dispatch({ type: "UPDATE_FIELD", sectionId: selected.section.id, field })}
                onRemove={() => {
                  dispatch({ type: "REMOVE_FIELD", sectionId: selected.section.id, fieldId: selected.field.id });
                  setSelectedFieldId(null);
                }}
                onDuplicate={() => dispatch({ type: "DUPLICATE_FIELD", sectionId: selected.section.id, fieldId: selected.field.id })}
                availableFields={allFields.filter((f) => f.id !== selected.field.id)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <ImageIcon className="size-8 opacity-40" />
                <p className="font-medium">No field selected</p>
                <p className="text-xs">Click a field in the preview to edit its properties here.</p>
              </div>
            )}
          </aside>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            <div className="flex items-center gap-2 rounded-lg border border-primary bg-background px-3 py-2 text-sm font-medium shadow-lg">
              {activeDrag.icon ? <FieldIcon name={activeDrag.icon} className="size-4 text-primary" /> : null}
              {activeDrag.label}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Mobile properties panel (below canvas on small screens) */}
      {selected ? (
        <div className="border-t border-border bg-surface lg:hidden">
          <div className="max-h-[55vh] overflow-y-auto">
            <PropertiesPanel
              key={`m-${selected.field.id}`}
              field={selected.field}
              onUpdate={(field) => dispatch({ type: "UPDATE_FIELD", sectionId: selected.section.id, field })}
              onRemove={() => {
                dispatch({ type: "REMOVE_FIELD", sectionId: selected.section.id, fieldId: selected.field.id });
                setSelectedFieldId(null);
              }}
              onDuplicate={() => dispatch({ type: "DUPLICATE_FIELD", sectionId: selected.section.id, fieldId: selected.field.id })}
              availableFields={allFields.filter((f) => f.id !== selected.field.id)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
