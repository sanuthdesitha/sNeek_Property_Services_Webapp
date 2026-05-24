export function UploadFailed({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M60 30 L60 70" />
      <path d="M45 45 L60 30 L75 45" />
      <line x1="30" y1="85" x2="90" y2="85" />
      <line x1="40" y1="25" x2="80" y2="75" strokeWidth="2.5" />
    </svg>
  );
}
