"use client";
import * as React from "react";
import type { formNavigation } from "@/lib/forms/navigation";

export function FormNavigation({ navigation }: { navigation: ReturnType<typeof formNavigation> }) {
  const [lastRoom, setLastRoom] = React.useState<string | null>(null);
  const incomplete = navigation.rooms.filter(room => room.remaining.length);
  function jump(room: (typeof navigation.rooms)[number]) {
    const first = room.remaining[0]; if (!first) return;
    setLastRoom(room.id);
    window.dispatchEvent(new CustomEvent("sneek:focus-field", { detail: { fieldId: first.fieldId, sectionId: room.id } }));
  }
  function next() {
    const previous = incomplete.findIndex(room => room.id === lastRoom);
    const room = incomplete[(previous + 1) % incomplete.length]; if (room) jump(room);
  }
  return <nav aria-label="Form room navigation" className="rounded border p-3 space-y-2 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><p aria-live="polite">{navigation.errors.length} items to finish</p>
      <button type="button" className="min-h-11 rounded border px-3" disabled={!incomplete.length} onClick={next}>Next incomplete room</button></div>
    <ul className="space-y-1">{navigation.rooms.map(room => <li key={room.id}>
      {room.remaining.length ? <button type="button" className="min-h-11 text-left underline" onClick={() => jump(room)}>{room.label}: {room.remaining.length} remaining</button>
        : <span>{room.label}: {!room.visible ? "Not applicable to current answers and property" : room.total ? "Required items complete" : "No required items currently apply"}</span>}
      {room.visible && room.notApplicable > 0 ? <span className="ml-2 text-xs">{room.notApplicable} required items not applicable to current answers and property</span> : null}
      {room.answeredNotApplicable > 0 ? <span className="ml-2 text-xs">{room.answeredNotApplicable} answered N/A</span> : null}
    </li>)}</ul>
    <p className="text-xs">Not applicable is determined by the form conditions. It does not fill in unanswered items or waive evidence.</p>
  </nav>;
}
