export function NoShifts({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="60" cy="60" r="35" />
      <path d="M60 35 L60 60 L78 70" strokeWidth="2.5" />
    </svg>
  );
}
