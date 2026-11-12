"use client";

import * as React from "react";
import { EPill } from "@/components/v2/ui/pill";
import { EButton } from "@/components/v2/ui/primitives";
import { TRANSPORT_LABEL } from "@/lib/notifications/catalog-types";
import type { NotificationHealth, TransportHealth } from "@/lib/notifications/health-types";
import { TEST_SEND_SECTION_ID } from "./wording-test-send";

type HealthState = { health: NotificationHealth | null; failed: boolean };

let shared: Promise<NotificationHealth | null> | null = null;

/** One health read shared by the header badges and the Health tab count (per page load). */
function readHealthOnce(): Promise<NotificationHealth | null> {
  shared ??= fetch("/api/admin/notifications/health", { cache: "no-store" })
    .then(async (response) => (response.ok ? ((await response.json()) as NotificationHealth) : null))
    .catch(() => null);
  return shared;
}

function useHealthSummary(): HealthState {
  const [state, setState] = React.useState<HealthState>({ health: null, failed: false });
  React.useEffect(() => {
    let current = true;
    void readHealthOnce().then((health) => {
      if (current) setState({ health, failed: health === null });
    });
    return () => { current = false; };
  }, []);
  return state;
}

function problem(transport: TransportHealth): string | null {
  if (transport.configured === false) return `${TRANSPORT_LABEL[transport.transport]}: not configured`;
  if (transport.failures24h > 0) return `${TRANSPORT_LABEL[transport.transport]}: ${transport.failures24h} failure${transport.failures24h === 1 ? "" : "s"}, 24 h`;
  return null;
}

export function healthProblems(health: NotificationHealth): string[] {
  return health.transports.flatMap((transport) => {
    const text = problem(transport);
    return text ? [text] : [];
  });
}

/** Header badges: which transports are working, which failed in the last 24 h. Not proof of delivery. */
export function NotificationHeaderStatus({ showTestButton }: { showTestButton: boolean }) {
  const { health, failed } = useHealthSummary();
  const problems = health ? healthProblems(health) : [];
  const working = health ? health.transports.filter((transport) => transport.configured !== false && transport.failures24h === 0 && transport.configured !== null).map((transport) => TRANSPORT_LABEL[transport.transport]) : [];

  function focusTest() {
    const section = document.getElementById(TEST_SEND_SECTION_ID);
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "center" });
    section.focus({ preventScroll: true });
  }

  return (
    <>
      {failed ? <EPill tone="neutral">Transport health unknown</EPill> : null}
      {health && working.length ? <EPill tone="ok">{`${working.length === health.transports.length ? "All transports" : working.join(", ")} working`}</EPill> : null}
      {problems.slice(0, 2).map((text) => <EPill key={text} tone="warn">{text}</EPill>)}
      {problems.length > 2 ? <EPill tone="warn">{`+${problems.length - 2} more in Health`}</EPill> : null}
      {showTestButton ? <EButton variant="outline" size="sm" onClick={focusTest}>Send test to me</EButton> : null}
    </>
  );
}

/** The warning count shown on the Health tab label. */
export function HealthTabCount() {
  const { health } = useHealthSummary();
  const count = health ? healthProblems(health).length : 0;
  if (!count) return null;
  return <EPill tone="warn" className="ml-1">{count}<span className="sr-only"> transport problems</span></EPill>;
}
