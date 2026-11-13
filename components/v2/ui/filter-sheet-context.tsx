"use client";

/**
 * Whether a filter control is rendered inside the phone filter sheet of
 * `EFilterBar`. `EFilterPopover` and `EFilterChips` read it to lay themselves
 * out as plain labelled sections there instead of chips with popovers.
 */
import * as React from "react";

const FilterSheetContext = React.createContext(false);

export function FilterSheetProvider({ children }: { children: React.ReactNode }) {
  return <FilterSheetContext.Provider value={true}>{children}</FilterSheetContext.Provider>;
}

/** True inside an open phone filter sheet. */
export function useInFilterSheet(): boolean {
  return React.useContext(FilterSheetContext);
}
