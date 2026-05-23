export function EmptyInbox({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <rect x="20" y="40" width="80" height="50" rx="4" />
      <path d="M20 50 L60 75 L100 50" />
      <line x1="35" y1="30" x2="85" y2="30" strokeWidth="1.5" opacity="0.4" />
      <line x1="40" y1="25" x2="80" y2="25" strokeWidth="1.5" opacity="0.4" />
    </svg>
  );
}
