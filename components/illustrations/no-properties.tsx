export function NoProperties({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M25 60 L60 30 L95 60 L95 95 L25 95 Z" />
      <rect x="50" y="70" width="20" height="25" />
      <line x1="60" y1="70" x2="60" y2="95" strokeWidth="1.5" opacity="0.5" />
    </svg>
  );
}
