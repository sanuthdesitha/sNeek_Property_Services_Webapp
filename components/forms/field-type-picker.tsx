"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { FormFieldType } from "@/lib/forms/types";

const TYPES: ReadonlyArray<readonly [FormFieldType, string]> = [
  ["text", "Text"],
  ["longtext", "Long text"],
  ["number", "Number"],
  ["select", "Dropdown"],
  ["multiselect", "Multi-select"],
  ["checkbox", "Checkbox"],
  ["radio", "Radio"],
  ["photo", "Photo"],
  ["video", "Video"],
  ["signature", "Signature"],
  ["rating", "Rating"],
  ["time", "Time"],
  ["date", "Date"],
];

export interface FieldTypePickerProps {
  onPick: (type: FormFieldType) => void;
}

export function FieldTypePicker({ onPick }: FieldTypePickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 size-4" /> Add field
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {TYPES.map(([value, label]) => (
          <DropdownMenuItem key={value} onSelect={() => onPick(value)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
