"use client";

import { useState } from "react";
import { BellRing, RefreshCcw, Trash2 } from "lucide-react";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { CommsControlCenter } from "@/components/v2/admin/comms/control-center";
import { CommsDeliveryLog } from "@/components/v2/admin/comms/delivery-log";
import { CommsManualDispatch } from "@/components/v2/admin/comms/manual-dispatch";
import { useEstateToast, EToastViewport } from "@/components/v2/admin/comms/toast";

type Section = "control" | "dispatch" | "log";

export function CommsCenter() {
  const [section, setSection] = useState<Section>("control");
  const { toast, push } = useEstateToast();
  const [testingPush, setTestingPush] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [reloadSignal, setReloadSignal] = useState(0);

  async function sendTestPush() {
    setTestingPush(true);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        push({ title: "Test push not sent", description: body.error ?? "Could not send the test push.", tone: "danger" });
        return;
      }
      push({ title: "Test push sent", description: `Dispatched to ${body.devices ?? 0} device(s).`, tone: "success" });
    } finally {
      setTestingPush(false);
    }
  }

  async function clearAll() {
    setClearing(true);
    const res = await fetch("/api/admin/notifications/log", { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setClearing(false);
    if (!res.ok) {
      push({ title: "Clear failed", description: body.error ?? "Could not clear notification log.", tone: "danger" });
      return;
    }
    push({ title: "Notification log cleared", tone: "success" });
    setClearOpen(false);
    setReloadSignal((n) => n + 1);
  }

  const sectionBtn = (key: Section, label: string) => (
    <button
      type="button"
      onClick={() => setSection(key)}
      aria-current={section === key ? "page" : undefined}
      className={`rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors ${
        section === key ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Communications"
        title="Comms center"
        description="Notification defaults, timed automation, profile overrides, and delivery history."
        actions={
          <div className="flex flex-wrap gap-2">
            <EButton variant="outline" size="sm" onClick={sendTestPush} disabled={testingPush}>
              <BellRing className="h-4 w-4" />{testingPush ? "Sending…" : "Test push"}
            </EButton>
            <EButton variant="outline" size="sm" onClick={() => setReloadSignal((n) => n + 1)}>
              <RefreshCcw className="h-4 w-4" />Refresh
            </EButton>
            <EButton variant="danger" size="sm" onClick={() => setClearOpen(true)}>
              <Trash2 className="h-4 w-4" />Clear logs
            </EButton>
          </div>
        }
      />

      <div className="inline-flex items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
        {sectionBtn("control", "Control center")}
        {sectionBtn("dispatch", "Manual dispatch")}
        {sectionBtn("log", "Delivery log")}
      </div>

      {section === "control" ? <CommsControlCenter onToast={push} /> : null}
      {section === "dispatch" ? <CommsManualDispatch onToast={push} /> : null}
      {section === "log" ? <CommsDeliveryLog onToast={push} reloadSignal={reloadSignal} /> : null}

      <EConfirmModal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear notifications"
        description="This will remove all notification logs from the system."
        confirmLabel="Clear logs"
        loading={clearing}
        onConfirm={clearAll}
      />

      <EToastViewport toast={toast} />
    </div>
  );
}
