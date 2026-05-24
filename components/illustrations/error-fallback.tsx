export function ErrorFallback({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M60 25 L100 90 L20 90 Z" />
      <line x1="60" y1="50" x2="60" y2="70" strokeWidth="2.5" />
      <circle cx="60" cy="80" r="2" fill="currentColor" />
    </svg>
  );
}
