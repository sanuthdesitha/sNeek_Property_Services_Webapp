"use client";

/**
 * Ties a field wrapper's `<label>` (and hint) to its control without changing
 * call sites: when the wrapper's only child is a single known form control,
 * the control receives the generated id (unless it already has one) and the
 * hint id in `aria-describedby`. Anything else (several children, a layout
 * `<div>`, a composite widget that does not forward `id`) renders exactly as
 * before and the label stays unassociated, so no control is mislabelled.
 *
 * Known controls: native `input` / `select` / `textarea`, and components
 * marked with `markFieldControl` (they forward `id` and ARIA props to the
 * native element).
 */
import * as React from "react";

const FIELD_CONTROL = Symbol.for("sneek.estateFieldControl");

type MarkableComponent = { [FIELD_CONTROL]?: true };
type ControlProps = { id?: string; "aria-describedby"?: string };

const NATIVE_CONTROLS = new Set<string>(["input", "select", "textarea"]);

/** Declare that a component forwards `id` / `aria-describedby` to its native control. */
export function markFieldControl<T extends object>(component: T): T {
  (component as MarkableComponent)[FIELD_CONTROL] = true;
  return component;
}

function isFieldControl(element: React.ReactElement): boolean {
  if (typeof element.type === "string") {
    if (!NATIVE_CONTROLS.has(element.type)) return false;
    // A hidden input is not a labelled control.
    return (element.props as { type?: string }).type !== "hidden";
  }
  const type = element.type as unknown;
  return (typeof type === "function" || (typeof type === "object" && type !== null))
    && (type as MarkableComponent)[FIELD_CONTROL] === true;
}

export type AssociatedField = {
  /** Id for `<label htmlFor>`; undefined when the child is not a single control. */
  controlId: string | undefined;
  /** Id to put on the hint element. */
  hintId: string;
  /** The children, with the single control given its id / description. */
  control: React.ReactNode;
};

export function useAssociatedField(children: React.ReactNode, options: { hasHint: boolean; htmlFor?: string }): AssociatedField {
  const generated = React.useId();
  const hintId = `${generated}-hint`;
  const only = React.Children.count(children) === 1 && React.isValidElement(children) ? children : null;
  if (!only || !isFieldControl(only)) {
    return { controlId: options.htmlFor, hintId, control: children };
  }
  const props = only.props as ControlProps;
  const controlId = props.id ?? options.htmlFor ?? `${generated}-control`;
  const describedBy = options.hasHint
    ? [props["aria-describedby"], hintId].filter(Boolean).join(" ")
    : props["aria-describedby"];
  const control = React.cloneElement(only as React.ReactElement<ControlProps>, {
    id: controlId,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
  });
  return { controlId, hintId, control };
}
