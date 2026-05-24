export function NoClients({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="60" cy="45" r="15" />
      <path d="M30 95 Q30 75 60 75 Q90 75 90 95" />
    </svg>
  );
}
