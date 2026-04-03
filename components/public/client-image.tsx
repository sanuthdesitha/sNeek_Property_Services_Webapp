"use client";

interface ClientImageProps {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
}

export function ClientImage({ src, alt, className, loading = "lazy" }: ClientImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}

export function ClientImageCover({ src, alt, className, loading = "lazy" }: ClientImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      onError={(e) => {
        const el = e.currentTarget;
        el.style.background = "hsl(var(--muted))";
        el.style.minHeight = "13rem";
        el.removeAttribute("src");
      }}
    />
  );
}
