export function NoInvoices({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M35 20 L85 20 L85 95 L75 90 L65 95 L55 90 L45 95 L35 90 Z" />
      <line x1="48" y1="40" x2="72" y2="40" opacity="0.5" />
      <line x1="48" y1="55" x2="72" y2="55" opacity="0.5" />
      <line x1="48" y1="70" x2="72" y2="70" strokeWidth="2.5" />
    </svg>
  );
}
