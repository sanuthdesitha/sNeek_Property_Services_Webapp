"use client";
import { useId } from "react";
import "@/components/operations/operations.css";
import { DEVICE_EXCEPTION_LABELS, isDeviceConfirmed, isDeviceException, type DeviceExceptionStatus } from "@/lib/forms/device-status";
/** Changing a device outcome is explicit; mounting never rewrites an existing answer. */
export function DeviceStatusInput({ field, value, onChange, disabled = false }: { field: { id: string; label: string }; value: unknown; onChange: (value: unknown) => void; disabled?: boolean }) {
  const helpId = useId();
  const exception = isDeviceException(value) ? value : null;
  const status = exception?.deviceStatus ?? (isDeviceConfirmed(value) ? "CONFIRMED" : "");
  return <div className="ops-content space-y-3">
    <select aria-describedby={exception ? helpId : undefined} aria-label={`${field.label} — device status`} className="min-h-11 w-full rounded-md border bg-background p-2 text-sm" value={status} disabled={disabled}
      onChange={event => { const next = event.target.value; onChange(next === "CONFIRMED" ? true : { deviceStatus: next as DeviceExceptionStatus, reason: exception?.reason ?? "" }); }}>
      <option value="" disabled>Select what you actually observed</option>
      <option value="CONFIRMED">{/charg/i.test(field.label) ? "Checked / charged" : "Checked / working"}</option>
      {Object.entries(DEVICE_EXCEPTION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
    {value === false ? <p className="text-sm">Previously recorded: No. Choose an outcome and explain it to update this check.</p> : null}
    {exception ? <label className="block text-sm">Reason (required)
      <textarea aria-required="true" aria-describedby={helpId} aria-label={`${field.label} — reason`} className="mt-1 min-h-20 w-full rounded-md border bg-background p-2" maxLength={2000} value={exception.reason} disabled={disabled} onChange={event => onChange({ ...exception, reason: event.target.value })} />
      <span id={helpId} className="mt-2 block text-xs text-muted-foreground">This records an exception for review. It does not confirm the device is working or charged.</span>
    </label> : null}
  </div>;
}
