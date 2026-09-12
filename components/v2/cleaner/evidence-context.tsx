"use client";
import { createContext, useContext } from "react";
import type { EvidenceScope } from "@/lib/cleaner/evidence-store";
export const EvidenceContext = createContext<EvidenceScope | null | undefined>(undefined);
export const useEvidenceScope = () => useContext(EvidenceContext);
