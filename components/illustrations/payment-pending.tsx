export function PaymentPending({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <rect x="20" y="35" width="80" height="50" rx="4" />
      <line x1="20" y1="50" x2="100" y2="50" />
      <circle cx="60" cy="68" r="10" />
      <line x1="60" y1="64" x2="60" y2="68" strokeWidth="2.5" />
      <line x1="60" y1="68" x2="63" y2="70" strokeWidth="2.5" />
    </svg>
  );
}
