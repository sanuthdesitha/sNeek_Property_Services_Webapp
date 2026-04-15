"use client";

import { cn } from "@/lib/utils";
import { createContext, useContext, useState, forwardRef, HTMLAttributes } from "react";

interface TabsContextValue {
  value: string;
  onChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue>({
  value: "",
  onChange: () => {},
});

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  className,
  children,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const handleChange = (newValue: string) => {
    if (!isControlled) setInternalValue(newValue);
    onValueChange?.(newValue);
  };

  return (
    <TabsContext.Provider value={{ value: currentValue, onChange: handleChange }}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: selectedValue, onChange } = useContext(TabsContext);
  const isSelected = selectedValue === value;

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        "text-text-secondary hover:text-text-primary",
        isSelected
          ? "bg-white dark:bg-neutral-700 text-text-primary shadow-sm"
          : "hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50",
        className,
      )}
      onClick={() => onChange(value)}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: selectedValue } = useContext(TabsContext);
  if (selectedValue !== value) return null;

  return <div className={cn("mt-4 animate-fade-in", className)}>{children}</div>;
}
