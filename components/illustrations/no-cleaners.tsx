export function NoCleaners({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="60" cy="40" r="12" />
      <path d="M40 95 L40 65 Q60 60 80 65 L80 95" />
      <rect x="50" y="80" width="20" height="6" fill="currentColor" opacity="0.3" />
    </svg>
  );
}
