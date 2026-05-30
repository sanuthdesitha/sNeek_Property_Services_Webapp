"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { SectionEditor } from "./section-editor";
import type { FormField, FormSchema } from "@/lib/forms/types";

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
  | { type: "REMOVE_SECTION"; sectionId: string }
  | { type: "UPDATE_SECTION_TITLE"; sectionId: string; title: string }
  | { type: "REORDER_SECTIONS"; from: number; to: number }
  | { type: "ADD_FIELD"; sectionId: string; field: FormField }
  | { type: "UPDATE_FIELD"; sectionId: string; field: FormField }
  | { type: "REMOVE_FIELD"; sectionId: string; fieldId: string }
  | { type: "REORDER_FIELDS"; sectionId: string; from: number; to: number }
  | { type: "MARK_CLEAN" };

interface State {
  name: string;
  schema: FormSchema;
  dirty: boolean;
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
          sections: [
            ...state.schema.sections,
            { id: `s-${Date.now()}`, title: "New section", fields: [] },
          ],
        },
      };
    case "REMOVE_SECTION":
      return {
        ...state,
        dirty: true,
        schema: {
          sections: state.schema.sections.filter((s) => s.id !== action.sectionId),
        },
      };
    case "UPDATE_SECTION_TITLE":
      return {
        ...state,
        dirty: true,
        schema: {
          sections: state.schema.sections.map((s) =>
            s.id === action.sectionId ? { ...s, title: action.title } : s,
          ),
        },
      };
    case "REORDER_SECTIONS":
      return {
        ...state,
        dirty: true,
        schema: {
          sections: arrayMove(state.schema.sections, action.from, action.to),
        },
      };
    case "ADD_FIELD":
      return {
        ...state,
        dirty: true,
        schema: {
          sections: state.schema.sections.map((s) =>
            s.id === action.sectionId
              ? { ...s, fields: [...s.fields, action.field] }
              : s,
          ),
        },
      };
    case "UPDATE_FIELD":
      return {
        ...state,
        dirty: true,
        schema: {
          sections: state.schema.sections.map((s) =>
            s.id === action.sectionId
              ? {
                  ...s,
                  fields: s.fields.map((f) =>
                    f.id === action.field.id ? action.field : f,
                  ),
                }
              : s,
          ),
        },
      };
    case "REMOVE_FIELD":
      return {
        ...state,
        dirty: true,
        schema: {
          sections: state.schema.sections.map((s) =>
            s.id === action.sectionId
              ? { ...s, fields: s.fields.filter((f) => f.id !== action.fieldId) }
              : s,
          ),
        },
      };
    case "REORDER_FIELDS":
      return {
        ...state,
        dirty: true,
        schema: {
          sections: state.schema.sections.map((s) =>
            s.id === action.sectionId
              ? { ...s, fields: arrayMove(s.fields, action.from, action.to) }
              : s,
          ),
        },
      };
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
  const router = useRouter();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
      const res = await fetch(
        `/api/admin/form-templates/${templateId}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
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
      const res = await fetch(
        `/api/admin/form-templates/${templateId}/duplicate`,
        { method: "POST" },
      );
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

  function handleSectionDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = state.schema.sections.findIndex((s) => s.id === active.id);
    const to = state.schema.sections.findIndex((s) => s.id === over.id);
    if (from === -1 || to === -1) return;
    dispatch({ type: "REORDER_SECTIONS", from, to });
  }

  const totalFields = state.schema.sections.reduce(
    (sum, s) => sum + s.fields.length,
    0,
  );

  // All fields across the form, used to populate the conditional-logic field
  // picker in each field editor.
  const allFields = state.schema.sections.flatMap((s) =>
    s.fields.map((f) => ({ id: f.id, label: f.label })),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Input
            value={state.name}
            onChange={(e) => dispatch({ type: "SET_NAME", name: e.target.value })}
            className="text-xl font-semibold"
            aria-label="Template name"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {initialKind} · v{initialVersion} ·{" "}
            {state.schema.sections.length} sections · {totalFields} fields
          </p>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {savedAt && !state.dirty && (
            <span className="text-xs text-muted-foreground">
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          {state.dirty && <StatusPill variant="warning">Unsaved</StatusPill>}
          {archived ? (
            <StatusPill variant="neutral">Archived</StatusPill>
          ) : isActive ? (
            <StatusPill variant="success">Published</StatusPill>
          ) : (
            <StatusPill variant="warning">Draft</StatusPill>
          )}
          <Button variant="outline" onClick={duplicate}>
            Duplicate
          </Button>
          <Button variant="outline" onClick={togglePublish}>
            {isActive ? "Archive" : "Publish"}
          </Button>
          <Button onClick={save} disabled={saving || !state.dirty}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleSectionDragEnd}
      >
        <SortableContext
          items={state.schema.sections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3">
            {state.schema.sections.map((section) => (
              <SectionEditor
                key={section.id}
                section={section}
                onUpdateTitle={(title) =>
                  dispatch({
                    type: "UPDATE_SECTION_TITLE",
                    sectionId: section.id,
                    title,
                  })
                }
                onRemove={() =>
                  dispatch({ type: "REMOVE_SECTION", sectionId: section.id })
                }
                onAddField={(field) =>
                  dispatch({
                    type: "ADD_FIELD",
                    sectionId: section.id,
                    field,
                  })
                }
                onUpdateField={(field) =>
                  dispatch({
                    type: "UPDATE_FIELD",
                    sectionId: section.id,
                    field,
                  })
                }
                onRemoveField={(fieldId) =>
                  dispatch({
                    type: "REMOVE_FIELD",
                    sectionId: section.id,
                    fieldId,
                  })
                }
                onReorderFields={(from, to) =>
                  dispatch({
                    type: "REORDER_FIELDS",
                    sectionId: section.id,
                    from,
                    to,
                  })
                }
                availableFields={allFields}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button
        variant="outline"
        onClick={() => dispatch({ type: "ADD_SECTION" })}
      >
        + Add section
      </Button>
    </div>
  );
}
