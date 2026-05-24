export function NoJobs({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <rect x="25" y="30" width="70" height="65" rx="4" />
      <line x1="25" y1="48" x2="95" y2="48" />
      <line x1="40" y1="22" x2="40" y2="38" />
      <line x1="80" y1="22" x2="80" y2="38" />
      <circle cx="45" cy="65" r="3" fill="currentColor" opacity="0.3" />
      <circle cx="60" cy="65" r="3" fill="currentColor" opacity="0.3" />
      <circle cx="75" cy="65" r="3" fill="currentColor" opacity="0.3" />
    </svg>
  );
}
