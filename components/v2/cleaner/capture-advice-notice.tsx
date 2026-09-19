export function CaptureAdviceNotice({ advice, onDismiss }: { advice: Record<string, string[]>; onDismiss: () => void }) {
  if (!Object.keys(advice).length) return null;
  return <div role="status" aria-label="Capture advice" className="mt-2 rounded border border-current/25 p-3 text-xs">
    <p className="font-semibold">Review your capture</p>
    <ul className="mt-1 space-y-1">{Object.entries(advice).map(([name, messages]) => <li key={name}><span className="font-medium [overflow-wrap:anywhere]">{name}: </span>{messages.join(" ")}</li>)}</ul>
    <p className="mt-2">Open each preview to check orientation and detail. These checks do not confirm evidence quality.</p>
    <button type="button" onClick={onDismiss} className="mt-1 min-h-11 underline">Dismiss capture advice</button>
  </div>;
}
