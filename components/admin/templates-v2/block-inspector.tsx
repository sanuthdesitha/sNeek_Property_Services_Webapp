"use client";

/**
 * Block inspector (rebrand doc 03 §3.1) — an RHF form auto-generated from the
 * selected block's zod propsSchema. Field kinds are introspected from the
 * schema: string → input/textarea, number, boolean, enum/literal-union →
 * select, array-of-object → useFieldArray list editor. Adding a block type
 * never requires inspector changes.
 */

import * as React from "react";
import { useForm, useFieldArray, type UseFormRegister, type Control } from "react-hook-form";
import { z } from "zod";
import { BLOCK_REGISTRY } from "@/lib/templates/blocks/registry";
import type { Block } from "@/lib/templates/model";

// ---------------------------------------------------------------------------
// zod introspection
// ---------------------------------------------------------------------------

type FieldSpec =
  | { kind: "string"; name: string; multiline: boolean }
  | { kind: "number"; name: string; min?: number; max?: number }
  | { kind: "boolean"; name: string }
  | { kind: "select"; name: string; options: string[] }
  | { kind: "array"; name: string; item: FieldSpec[]; itemDefaults: Record<string, unknown> };

const MULTILINE_HINTS = ["text", "subline", "note", "emptyText"];

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let node = schema;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (node instanceof z.ZodDefault) node = node._def.innerType;
    else if (node instanceof z.ZodOptional) node = node._def.innerType;
    else return node;
  }
}

function fieldSpecFor(name: string, schema: z.ZodTypeAny): FieldSpec | null {
  const node = unwrap(schema);
  if (node instanceof z.ZodString) {
    return { kind: "string", name, multiline: MULTILINE_HINTS.includes(name) };
  }
  if (node instanceof z.ZodNumber) {
    return { kind: "number", name };
  }
  if (node instanceof z.ZodBoolean) {
    return { kind: "boolean", name };
  }
  if (node instanceof z.ZodEnum) {
    return { kind: "select", name, options: node._def.values as string[] };
  }
  if (node instanceof z.ZodUnion) {
    const literals = (node._def.options as z.ZodTypeAny[]).map((option) =>
      option instanceof z.ZodLiteral ? String(option._def.value) : null,
    );
    if (literals.every((value): value is string => value !== null)) {
      return { kind: "select", name, options: literals };
    }
    return null;
  }
  if (node instanceof z.ZodArray) {
    const element = unwrap(node._def.type as z.ZodTypeAny);
    if (element instanceof z.ZodObject) {
      const item: FieldSpec[] = [];
      const itemDefaults: Record<string, unknown> = {};
      for (const [childName, childSchema] of Object.entries(element.shape as Record<string, z.ZodTypeAny>)) {
        const spec = fieldSpecFor(childName, childSchema);
        if (spec && spec.kind !== "array") item.push(spec);
        const childNode = unwrap(childSchema);
        itemDefaults[childName] =
          childNode instanceof z.ZodNumber ? 0 : childNode instanceof z.ZodBoolean ? false : "";
      }
      return { kind: "array", name, item, itemDefaults };
    }
    return null;
  }
  return null;
}

export function specsForBlockType(type: string): FieldSpec[] {
  const def = BLOCK_REGISTRY[type];
  if (!def) return [];
  const schema = unwrap(def.propsSchema as unknown as z.ZodTypeAny);
  if (!(schema instanceof z.ZodObject)) return [];
  const specs: FieldSpec[] = [];
  for (const [name, child] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    const spec = fieldSpecFor(name, child);
    if (spec) specs.push(spec);
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Field renderers
// ---------------------------------------------------------------------------

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-600/30";
const LABEL_CLASS = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";

function labelText(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());
}

function ScalarField({
  spec,
  path,
  register,
}: {
  spec: Exclude<FieldSpec, { kind: "array" }>;
  path: string;
  register: UseFormRegister<Record<string, unknown>>;
}) {
  const name = path as never;
  if (spec.kind === "boolean") {
    return (
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" {...register(name)} className="h-4 w-4 accent-emerald-700" />
        {labelText(spec.name)}
      </label>
    );
  }
  return (
    <div>
      <label className={LABEL_CLASS}>{labelText(spec.name)}</label>
      {spec.kind === "string" && spec.multiline ? (
        <textarea rows={3} {...register(name)} className={INPUT_CLASS} />
      ) : spec.kind === "select" ? (
        <select {...register(name)} className={INPUT_CLASS}>
          {spec.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : spec.kind === "number" ? (
        <input type="number" {...register(name, { valueAsNumber: true })} className={INPUT_CLASS} />
      ) : (
        <input type="text" {...register(name)} className={INPUT_CLASS} />
      )}
    </div>
  );
}

function ArrayField({
  spec,
  control,
  register,
}: {
  spec: Extract<FieldSpec, { kind: "array" }>;
  control: Control<Record<string, unknown>>;
  register: UseFormRegister<Record<string, unknown>>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: spec.name as never });
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={LABEL_CLASS.replace("mb-1 block ", "")}>{labelText(spec.name)}</span>
        <button
          type="button"
          onClick={() => append(spec.itemDefaults as never)}
          className="rounded bg-emerald-700 px-2 py-0.5 text-[11px] font-semibold text-white"
        >
          + Add
        </button>
      </div>
      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
            <div className="space-y-2">
              {spec.item.map((child) => (
                <ScalarField
                  key={child.name}
                  spec={child as Exclude<FieldSpec, { kind: "array" }>}
                  path={`${spec.name}.${index}.${child.name}`}
                  register={register}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => remove(index)}
              className="mt-2 text-[11px] font-medium text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

export function BlockInspector({
  block,
  onChange,
}: {
  block: Block;
  onChange: (props: Record<string, unknown>, when: string) => void;
}) {
  const specs = React.useMemo(() => specsForBlockType(block.type), [block.type]);
  const def = BLOCK_REGISTRY[block.type];

  // Parse to fill defaults so RHF always has complete values.
  const initialValues = React.useMemo(() => {
    const parsed = def?.propsSchema.safeParse(block.props ?? {});
    const props = (parsed?.success ? parsed.data : def?.defaults() ?? {}) as Record<string, unknown>;
    return { ...props, __when: block.when ?? "" };
  }, [block.id, block.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const { register, control, watch, reset } = useForm<Record<string, unknown>>({
    defaultValues: initialValues,
  });

  // Re-seed the form when a different block is selected.
  React.useEffect(() => {
    reset(initialValues);
  }, [initialValues, reset]);

  // Live-sync form → doc (debounced a tick to batch keystrokes).
  React.useEffect(() => {
    const subscription = watch((values) => {
      const { __when, ...props } = values as Record<string, unknown>;
      onChange(props, typeof __when === "string" ? __when : "");
    });
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  if (!def) return <p className="p-3 text-[13px] text-slate-500">Unknown block.</p>;

  return (
    <form className="space-y-3 p-3" onSubmit={(event) => event.preventDefault()}>
      <p className="text-[13px] font-semibold text-slate-800">{def.label}</p>
      {specs.map((spec) =>
        spec.kind === "array" ? (
          <ArrayField key={spec.name} spec={spec} control={control} register={register} />
        ) : (
          <ScalarField key={spec.name} spec={spec} path={spec.name} register={register} />
        ),
      )}
      <div className="border-t border-slate-200 pt-3">
        <label className={LABEL_CLASS}>Show when (condition)</label>
        <input
          type="text"
          placeholder="e.g. invoice.gstEnabled"
          {...register("__when" as never)}
          className={INPUT_CLASS}
        />
        <p className="mt-1 text-[11px] text-slate-400">
          Data path; prefix ! to negate. Empty = always shown.
        </p>
      </div>
    </form>
  );
}
