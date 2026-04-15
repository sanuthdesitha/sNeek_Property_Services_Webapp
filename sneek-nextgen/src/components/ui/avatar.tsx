import { cn } from "@/lib/utils";
import { forwardRef, HTMLAttributes } from "react";

const Avatar = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
        className,
      )}
      {...props}
    />
  ),
);
Avatar.displayName = "Avatar";

const AvatarImage = forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
  ({ className, ...props }, ref) => (
    <img
      ref={ref}
      className={cn("aspect-square h-full w-full object-cover", className)}
      {...props}
    />
  ),
);
AvatarImage.displayName = "AvatarImage";

const AvatarFallback = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex h-full w-full items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-700 text-sm font-medium text-neutral-600 dark:text-neutral-300",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback };
