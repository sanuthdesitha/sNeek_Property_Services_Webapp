export function GpsOffline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="60" cy="55" r="22" />
      <circle cx="60" cy="55" r="8" fill="currentColor" />
      <path d="M60 77 L60 95" />
      <line x1="30" y1="30" x2="90" y2="90" strokeWidth="2.5" />
    </svg>
  );
}
