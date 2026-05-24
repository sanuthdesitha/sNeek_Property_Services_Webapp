export function NoQuotes({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M30 25 L80 25 L90 35 L90 95 L30 95 Z" />
      <line x1="80" y1="25" x2="80" y2="35" />
      <line x1="80" y1="35" x2="90" y2="35" />
      <line x1="40" y1="50" x2="80" y2="50" opacity="0.5" />
      <line x1="40" y1="60" x2="80" y2="60" opacity="0.5" />
      <line x1="40" y1="70" x2="70" y2="70" opacity="0.5" />
    </svg>
  );
}
