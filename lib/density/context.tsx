"use client";

import { createContext, useContext, type ReactNode } from "react";

export type Density = "compact" | "default" | "comfortable";

const DensityContext = createContext<Density>("default");

export function useDensity(): Density {
  return useContext(DensityContext);
}

export function DensityProvider({
  value = "default",
  children,
}: {
  value?: Density;
  children: ReactNode;
}) {
  return (
    <div data-density={value}>
      <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
    </div>
  );
}
