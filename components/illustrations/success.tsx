export function Success({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="60" cy="60" r="38" />
      <path d="M42 60 L54 72 L78 48" strokeWidth="3" />
    </svg>
  );
}
