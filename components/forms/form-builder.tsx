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
import { Eye, EyeOff, LayoutList, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { SectionEditor } from "./section-editor";
import { FormPreview } from "./form-preview";
import { ThemeEditor } from "./theme-editor";
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
  | { type: "UPDATE_SECTION_DESCRIPTION"; sectionId: string; description: string }
  | { type: "DUPLICATE_FIELD"; sectionId: string; fieldId: string }
  | { type: "REORDER_SECTIONS"; from: number; to: number }
  | { type: "ADD_FIELD"; sectionId: string; field: FormField }
  | { type: "UPDATE_FIELD"; sectionId: string; field: FormField }
  | { type: "REMOVE_FIELD"; sectionId: string; fieldId: string }
  | { type: "REORDER_FIELDS"; sectionId: string; from: number; to: number }
  | { type: "SET_THEME"; theme: FormSchema["theme"] }
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
    case "UPDATE_SECTION_DESCRIPTION":
      return {
        ...state,
        dirty: true,
        schema: {
          sections: state.schema.sections.map((s) =>
            s.id === action.sectionId
              ? { ...s, description: action.description || undefined }
              : s,
          ),
        },
      };
    case "DUPLICATE_FIELD":
      return {
        ...state,
        dirty: true,
        schema: {
          sections: state.schema.sections.map((s) => {
            if (s.id !== action.sectionId) return s;
            const index = s.fields.findIndex((f) => f.id === action.fieldId);
            if (index === -1) return s;
            const copy = duplicateField(s.fields[index]);
            const fields = [...s.fields];
            fields.splice(index + 1, 0, copy);
            return { ...s, fields };
          }),
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
    case "SET_THEME":
      return {
        ...state,
        dirty: true,
        schema: { ...state.schema, theme: action.theme },
      };
    case "MARK_CLEAN":
      return { ...state, dirty: false };
  }
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

  const [showPreview, setShowPreview] = React.useState(false);

  // Template-level stats: count sub-fields too.
  const flatFields = state.schema.sections.flatMap((s) =>
    s.fields.flatMap((f) => [f, ...(f.children ?? [])]),
  );
  const totalFields = flatFields.length;
  const requiredPhotoCount = flatFields.reduce((sum, f) => {
    if (!isUploadFieldType(f.type)) return sum;
    if (f.required) return sum + Math.max(1, f.minPhotos ?? 1);
    return sum + (f.minPhotos ?? 0);
  }, 0);

  // All fields across the form (incl. sub-fields), used to populate the
  // conditional-logic field picker in each field editor.
  const allFields = flatFields.map((f) => ({ id: f.id, label: f.label }));

  return (
    <div className={`mx-auto space-y-6 p-6 ${showPreview ? "max-w-7xl" : "max-w-4xl"}`}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Input
            value={state.name}
            onChange={(e) => dispatch({ type: "SET_NAME", name: e.target.value })}
            className="text-xl font-semibold"
            aria-label="Template name"
          />
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {initialKind} · v{initialVersion} ·{" "}
            {state.schema.sections.length} sections · {totalFields} fields ·{" "}
            {requiredPhotoCount} required photos
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
          <Button variant="outline" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? <EyeOff className="mr-1 size-4" /> : <Eye className="mr-1 size-4" />}
            {showPreview ? "Hide preview" : "Preview"}
          </Button>
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

      <div className={showPreview ? "grid items-start gap-6 lg:grid-cols-2" : undefined}>
        <div className="space-y-6">
          <Tabs defaultValue="sections">
            <TabsList>
              <TabsTrigger value="sections">
                <LayoutList className="mr-1.5 size-4" />
                Sections
              </TabsTrigger>
              <TabsTrigger value="theme">
                <Palette className="mr-1.5 size-4" />
                Theme
              </TabsTrigger>
            </TabsList>

            <TabsContent value="sections" className="space-y-6">
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
                        onUpdateDescription={(description) =>
                          dispatch({
                            type: "UPDATE_SECTION_DESCRIPTION",
                            sectionId: section.id,
                            description,
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
                        onDuplicateField={(fieldId) =>
                          dispatch({
                            type: "DUPLICATE_FIELD",
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
            </TabsContent>

            <TabsContent value="theme">
              <Card className="p-4">
                <ThemeEditor
                  theme={state.schema.theme}
                  onChange={(theme) => dispatch({ type: "SET_THEME", theme })}
                />
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {showPreview ? (
          <div className="lg:sticky lg:top-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Live preview — exactly what the cleaner sees
            </p>
            <div className="max-h-[80vh] overflow-y-auto rounded-xl border bg-muted/20 p-3">
              <FormPreview schema={state.schema} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
