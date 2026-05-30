"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { FormFieldType } from "@/lib/forms/types";
import {
  FIELD_TYPES,
  FIELD_CATEGORY_LABELS,
  FIELD_CATEGORY_ORDER,
  type FieldCategory,
} from "@/lib/forms/field-types";

export interface FieldTypePickerProps {
  onPick: (type: FormFieldType) => void;
}

const TYPES_BY_CATEGORY: Record<FieldCategory, FormFieldType[]> = FIELD_CATEGORY_ORDER.reduce(
  (acc, category) => {
    acc[category] = Object.values(FIELD_TYPES)
      .filter((def) => def.category === category)
      .map((def) => def.type);
    return acc;
  },
  {} as Record<FieldCategory, FormFieldType[]>
);

export function FieldTypePicker({ onPick }: FieldTypePickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 size-4" /> Add field
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[60vh] overflow-y-auto">
        {FIELD_CATEGORY_ORDER.map((category, idx) => (
          <React.Fragment key={category}>
            {idx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{FIELD_CATEGORY_LABELS[category]}</DropdownMenuLabel>
            {TYPES_BY_CATEGORY[category].map((type) => (
              <DropdownMenuItem key={type} onSelect={() => onPick(type)}>
                {FIELD_TYPES[type].label}
              </DropdownMenuItem>
            ))}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
