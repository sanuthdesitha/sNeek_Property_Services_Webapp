"use client";

/**
 * The Undo offered after a tier B removal (board "Confirmations and deletes").
 *
 * Use it ONLY where nothing has left the screen yet (a question removed from a
 * draft form, a line removed from a draft invoice before it is saved, a
 * checklist item in an unsaved library edit): Undo puts the same thing back in
 * the same place. Never offer it for a removal the server already made.
 */
import * as React from "react";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

/** How long Undo stays offered. */
export const UNDO_WINDOW_MS = 10_000;

export function undoToast({ title, description, onUndo }: { title: string; description?: string; onUndo: () => void }) {
  const handle = toast({
    title,
    description,
    duration: UNDO_WINDOW_MS,
    action: (
      <ToastAction
        altText={`Undo: ${title}`}
        className="max-sm:min-h-11 max-sm:px-4"
        onClick={() => {
          onUndo();
          handle.dismiss();
        }}
      >
        Undo
      </ToastAction>
    ),
  });
  return handle;
}
