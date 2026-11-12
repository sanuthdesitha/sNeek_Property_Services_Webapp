"use client";

/**
 * The existing stay-preparation panel for one property, with that property's
 * inventory items so an administrator can still edit the per-stay quantities
 * (the old Urgent stock tab offered this once a property was chosen).
 */
import * as React from "react";
import { StayPreparationPanel } from "@/components/inventory/stay-preparation-panel";

type ItemOption = { itemId: string; item: { name: string; unit: string } };
type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: ItemOption[] };

export function PropertyStayPreparation({ propertyId }: { propertyId: string }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  React.useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetch(`/api/inventory/urgent-stock?propertyId=${encodeURIComponent(propertyId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { items?: ItemOption[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.items) throw new Error(body?.error ?? "Could not load this property's items.");
        setLoad({ status: "ready", items: body.items });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load this property's items." });
      });
    return () => controller.abort();
  }, [propertyId]);
  if (load.status === "loading") return <p role="status" className="text-[0.8125rem]">Loading…</p>;
  if (load.status === "error") return <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{load.message}</p>;
  return <StayPreparationPanel key={propertyId} embedded propertyId={propertyId} isAdmin items={load.items} />;
}
