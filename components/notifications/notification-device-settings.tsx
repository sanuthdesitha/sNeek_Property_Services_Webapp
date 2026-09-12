"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { pushSupported, resolveVapidPublicKey, urlBase64ToBuffer } from "@/components/notifications/web-push-subscriber";

type DeviceState = { supported: boolean; permission: NotificationPermission | "unavailable"; worker: boolean; subscription: boolean; registered: boolean; configured: boolean };
const button = "min-h-11 rounded border px-3 text-sm focus-visible:outline focus-visible:outline-2 disabled:opacity-50";

export function NotificationDeviceSettings() {
  const { data: session, status } = useSession();
  const [expanded, setExpanded] = React.useState(false);
  if (status !== "authenticated" || !session?.user?.id) return null;
  return <div className="mx-4 mb-3 rounded border border-[hsl(var(--e-border))] p-3 text-sm">
    <button type="button" className={button} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>Notification settings and device</button>
    {expanded ? <DevicePanel key={JSON.stringify([session.user.id, session.user.role, session.impersonation])} readOnly={Boolean(session.impersonation)} /> : null}
  </div>;
}

function DevicePanel({ readOnly }: { readOnly: boolean }) {
  const [state, setState] = React.useState<DeviceState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  const inFlight = React.useRef(false);

  async function inspect() {
    const supported = pushSupported();
    const registration = supported ? await navigator.serviceWorker.getRegistration() : undefined;
    const subscription = registration?.active ? await registration.pushManager.getSubscription() : null;
    if (!alive.current) return;
    const response = await fetch("/api/push/status", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription?.endpoint ?? null }) });
    if (!response.ok) throw new Error("Could not check device registration. Try checking again.");
    const result = await response.json();
    if (typeof result.registered !== "boolean" || typeof result.configured !== "boolean") throw new Error("Could not check device registration. Try checking again.");
    if (alive.current) setState({ supported, permission: supported ? Notification.permission : "unavailable", worker: Boolean(registration?.active), subscription: Boolean(subscription), registered: result.registered, configured: result.configured });
  }

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null); setMessage(null);
    try { await action(); }
    catch (err) { if (alive.current) setError(err instanceof Error ? err.message : "Device operation failed. Try again."); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }

  React.useEffect(() => {
    alive.current = true;
    void run(inspect);
    return () => { alive.current = false; };
  }, []);

  async function enable() {
    if (readOnly || !pushSupported()) return;
    // Must happen directly in the click handler, before awaiting network work.
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (!alive.current) return;
    if (permission !== "granted") { await inspect(); throw new Error("Notifications are not permitted. Change this site's notification permission in browser settings, then check again."); }
    const vapid = await resolveVapidPublicKey();
    if (!alive.current) return;
    if (!vapid) throw new Error("Push is not configured on the server. Contact your administrator.");
    const registration = await navigator.serviceWorker.getRegistration();
    if (!alive.current) return;
    if (!registration?.active) throw new Error("The app's service worker is unavailable. Reload the app and check again.");
    const existing = await registration.pushManager.getSubscription();
    if (!alive.current) return;
    const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBuffer(vapid) });
    if (!alive.current) return;
    const response = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
    if (!response.ok) throw new Error("Browser subscription exists, but registration failed. Use Enable or repair to retry.");
    await inspect();
    if (alive.current) setMessage("Registration saved. This does not confirm delivery of a notification.");
  }

  async function remove() {
    if (readOnly || !pushSupported()) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!alive.current) return;
    if (subscription) {
      const response = await fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
      if (!response.ok) throw new Error("Could not remove this device registration. Try again.");
      if (!alive.current) return;
      if (!(await subscription.unsubscribe())) throw new Error("Server registration removed. Browser subscription could not be removed; check browser settings.");
    }
    await inspect();
    if (alive.current) setMessage("This device registration was removed. Browser permission is managed in your browser settings.");
  }

  async function localTest() {
    if (readOnly || Notification.permission !== "granted") return;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!alive.current) return;
    if (!registration?.active) throw new Error("No active service worker. Reload and check again.");
    await registration.showNotification("sNeek device display test", { body: "This local test checks browser display only. It does not test server push delivery.", tag: "sneek-local-display-test" });
    if (alive.current) setMessage("Browser accepted the local display test. Check your device notifications; this does not test server delivery.");
  }

  return <div className="mt-3 max-h-[45dvh] space-y-3 overflow-y-auto">
    <p>Category preferences control which updates you request. Web covers the in-app feed and browser push; browser push also needs permission and a registered device. Email and SMS depend on contact details, administrator settings and provider availability.</p>
    <p>These preferences do not configure a digest schedule. Account security or individually requested messages can follow separate sending rules; critical-event escalation is not configured here.</p>
    <p>Change category preferences in your profile or portal settings. Turning on a channel does not guarantee delivery.</p>
    {busy ? <p role="status">Checking or updating this device...</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {state ? <dl className="grid grid-cols-2 gap-2">
      <dt>Browser support</dt><dd>{state.supported ? "Supported" : "Unavailable"}</dd>
      <dt>Browser permission</dt><dd>{state.permission}</dd>
      <dt>App service worker</dt><dd>{state.worker ? "Active" : "Unavailable"}</dd>
      <dt>Browser subscription</dt><dd>{state.subscription ? "Present" : "Missing"}</dd>
      <dt>Registered to this account</dt><dd>{state.registered ? "Yes" : "No"}</dd>
      <dt>Server push configuration</dt><dd>{state.configured ? "Configured" : "Unavailable"}</dd>
    </dl> : null}
    {state && !state.supported ? <p>Use a browser that supports push. On iPhone or iPad, add the app to your Home Screen and open it there. Browser support can vary.</p> : null}
    {state?.permission === "denied" ? <p>Notifications are blocked. Change this site's permission in your browser settings, then check again.</p> : null}
    {readOnly ? <p>Device changes and tests are disabled while impersonating another account.</p> : null}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy} onClick={() => { void run(inspect); }}>Check device</button>
      <button type="button" className={button} disabled={busy || readOnly || !state?.supported || !state.worker || !state.configured || state.permission === "denied"} onClick={() => { void run(enable); }}>Enable or repair</button>
      <button type="button" className={button} disabled={busy || readOnly || !state?.subscription} onClick={() => { void run(remove); }}>Remove this device</button>
      <button type="button" className={button} disabled={busy || readOnly || !state?.worker || state.permission !== "granted"} onClick={() => { void run(localTest); }}>Test local display</button>
    </div>
  </div>;
}
